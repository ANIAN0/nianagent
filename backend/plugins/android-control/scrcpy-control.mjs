import { spawn } from "node:child_process"
import net from "node:net"
import { randomInt, randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { diagnoseAdbError } from "./adb.mjs"

// The control protocol is private to the matching scrcpy release.
export const SCRCPY_CONTROL_VERSION = "5.0.1"

// Android KeyEvent constants
export const ANDROID_KEYCODES = {
  home: 3,
  back: 4,
  power: 26,
  "volume-up": 24,
  "volume-down": 25,
  enter: 66,
  delete: 67,
  recents: 187,
  tab: 61,
  escape: 111,
  space: 62,
}

const TYPE_INJECT_KEYCODE = 0
const TYPE_INJECT_TEXT = 1
const TYPE_INJECT_TOUCH_EVENT = 2
const TYPE_INJECT_SCROLL_EVENT = 3
const TYPE_BACK_OR_SCREEN_ON = 4
const TYPE_EXPAND_NOTIFICATION_PANEL = 5
const TYPE_COLLAPSE_PANELS = 7
const TYPE_GET_CLIPBOARD = 8
const TYPE_SET_CLIPBOARD = 9
const TYPE_SET_DISPLAY_POWER = 10
const TYPE_ROTATE_DEVICE = 11
const TYPE_START_APP = 16

const ACTION_DOWN = 0
const ACTION_UP = 1
const ACTION_MOVE = 2
const BUTTON_PRIMARY = 1
const POINTER_ID = -1n
const INJECT_TEXT_MAX_BYTES = 280

function encodePosition(buf, offset, x, y, screenWidth, screenHeight) {
  buf.writeInt32BE(Math.round(x), offset)
  buf.writeInt32BE(Math.round(y), offset + 4)
  buf.writeUInt16BE(
    Math.max(1, Math.min(0xffff, Math.round(screenWidth))),
    offset + 8
  )
  buf.writeUInt16BE(
    Math.max(1, Math.min(0xffff, Math.round(screenHeight))),
    offset + 10
  )
}

function msgInjectTouch(action, x, y, screenWidth, screenHeight) {
  const buf = Buffer.allocUnsafe(32)
  buf.writeUInt8(TYPE_INJECT_TOUCH_EVENT, 0)
  buf.writeUInt8(action, 1)
  buf.writeBigInt64BE(POINTER_ID, 2)
  encodePosition(buf, 10, x, y, screenWidth, screenHeight)
  buf.writeUInt16BE(action === ACTION_UP ? 0 : 0xffff, 22)
  buf.writeInt32BE(action === ACTION_MOVE ? 0 : BUTTON_PRIMARY, 24)
  buf.writeInt32BE(action === ACTION_UP ? 0 : BUTTON_PRIMARY, 28)
  return buf
}

function msgInjectKeycode(action, keycode, repeat = 0, metaState = 0) {
  const buf = Buffer.allocUnsafe(14)
  buf.writeUInt8(TYPE_INJECT_KEYCODE, 0)
  buf.writeUInt8(action, 1)
  buf.writeInt32BE(keycode, 2)
  buf.writeInt32BE(repeat, 6)
  buf.writeInt32BE(metaState, 10)
  return buf
}

function msgInjectTextChunk(text) {
  const raw = Buffer.from(text, "utf8")
  const buf = Buffer.allocUnsafe(5 + raw.length)
  buf.writeUInt8(TYPE_INJECT_TEXT, 0)
  buf.writeUInt32BE(raw.length, 1)
  raw.copy(buf, 5)
  return buf
}

function splitUtf8Text(text, maxBytes = INJECT_TEXT_MAX_BYTES) {
  const chunks = []
  let current = ""
  let currentBytes = 0
  for (const ch of String(text || "")) {
    const chBytes = Buffer.byteLength(ch, "utf8")
    if (currentBytes + chBytes > maxBytes && current) {
      chunks.push(current)
      current = ch
      currentBytes = chBytes
    } else {
      current += ch
      currentBytes += chBytes
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function floatToI16FixedPoint(value) {
  const clamped = Math.max(-1, Math.min(1, value))
  if (clamped >= 1) return 0x7fff
  if (clamped <= -1) return -0x8000
  return Math.round(clamped * 0x7fff)
}

function msgInjectScroll(x, y, screenWidth, screenHeight, hScroll, vScroll) {
  const buf = Buffer.allocUnsafe(21)
  buf.writeUInt8(TYPE_INJECT_SCROLL_EVENT, 0)
  encodePosition(buf, 1, x, y, screenWidth, screenHeight)
  buf.writeInt16BE(floatToI16FixedPoint(hScroll / 16), 13)
  buf.writeInt16BE(floatToI16FixedPoint(vScroll / 16), 15)
  buf.writeInt32BE(0, 17)
  return buf
}

function msgEmpty(type) {
  return Buffer.from([type])
}

function msgSetDisplayPower(on) {
  return Buffer.from([TYPE_SET_DISPLAY_POWER, on ? 1 : 0])
}

function msgBackOrScreenOn(action) {
  return Buffer.from([TYPE_BACK_OR_SCREEN_ON, action])
}

function msgGetClipboard(copyKey = 0) {
  return Buffer.from([TYPE_GET_CLIPBOARD, copyKey])
}

function msgSetClipboard(sequence, text, paste = false) {
  const raw = Buffer.from(text, "utf8")
  const buf = Buffer.allocUnsafe(14 + raw.length)
  buf.writeUInt8(TYPE_SET_CLIPBOARD, 0)
  buf.writeBigInt64BE(BigInt(sequence), 1)
  buf.writeUInt8(paste ? 1 : 0, 9)
  buf.writeUInt32BE(raw.length, 10)
  raw.copy(buf, 14)
  return buf
}

function msgStartApp(packageName) {
  const raw = Buffer.from(packageName, "utf8")
  if (raw.length > 255) throw new Error("应用包名长度超出协议限制。")
  const buf = Buffer.allocUnsafe(2 + raw.length)
  buf.writeUInt8(TYPE_START_APP, 0)
  buf.writeUInt8(raw.length, 1)
  raw.copy(buf, 2)
  return buf
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function waitForRequest(promise, signal) {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason)
    signal.addEventListener("abort", cancel, { once: true })
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", cancel)
    })
  })
}

function readControlHandshake(port, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1")
    const fail = (error) => {
      socket.destroy()
      reject(error)
    }
    const cancel = () => fail(signal.reason)
    const closed = () => fail(new Error("scrcpy-server 在握手前断开"))
    socket.once("error", fail)
    socket.once("close", closed)
    socket.once("data", (data) => {
      if (data[0] !== 0) {
        fail(new Error("scrcpy-server 握手字节无效"))
        return
      }
      socket.pause()
      resolve({ socket, initialRemainder: data.subarray(1) })
    })
    signal.addEventListener("abort", cancel, { once: true })
    const detach = () => {
      socket.removeListener("close", closed)
      signal.removeEventListener("abort", cancel)
    }
    socket.once("close", detach)
    socket.once("data", detach)
  })
}

async function connectControlSocket(port, signal) {
  const deadline = AbortSignal.timeout(8000)
  const startup = AbortSignal.any([deadline, signal])
  await delay(150, undefined, { signal: startup })
  while (true) {
    try {
      return await readControlHandshake(port, startup)
    } catch (error) {
      if (signal.aborted) throw signal.reason
      if (deadline.aborted)
        throw new Error("等待 scrcpy-server 握手超时", { cause: error })
      await delay(120, undefined, { signal: startup })
    }
  }
}

export function createScrcpyControlPool({ adb, runAdb, getInstallation }) {
  const connections = new Map()
  const pendingJarRemovals = new Map()
  const IDLE_MS = 5 * 60 * 1000
  let stopped = false

  const exec = async (adbPath, args, timeoutMs) => {
    const result = await runAdb(adbPath, args, { timeoutMs })
    if (result.code !== 0) {
      throw new Error(diagnoseAdbError(result.stderr || result.stdout))
    }
    return result.stdout.trim()
  }

  const removeJar = (adbPath, serial, path) =>
    exec(adbPath, ["-s", serial, "shell", "rm", "-f", path], 3000)

  const closeEntry = (entry) => {
    if (entry.closing) return entry.closing
    entry.controller.abort(new Error("scrcpy 控制连接已停止。"))
    clearTimeout(entry.idleTimer)
    entry.closing = (async () => {
      // ADB mutations may already be in progress. Wait until ownership is
      // known before removing the resources, even when startup was stopped.
      await entry.ready.catch(() => {})
      const { adbPath, serial, serverProcess, socket, socketName, remoteJar } =
        entry
      socket?.destroy()
      serverProcess?.kill()
      if (serverProcess) await entry.serverClosed
      await Promise.all([
        (async () => {
          if (!socketName) return
          const forwards = await exec(adbPath, ["forward", "--list"], 3000)
          const line = forwards.split(/\r?\n/).find((item) => {
            const [device, port, target] = item.trim().split(/\s+/)
            return (
              device === serial &&
              /^tcp:\d+$/.test(port) &&
              target === `localabstract:${socketName}`
            )
          })
          if (line) {
            const port = line.trim().split(/\s+/)[1]
            await exec(
              adbPath,
              ["-s", serial, "forward", "--remove", port],
              3000
            )
          }
        })().catch(() => {}),
        remoteJar &&
          removeJar(adbPath, serial, remoteJar).catch(() => {
            const jars = pendingJarRemovals.get(serial) || new Set()
            jars.add(remoteJar)
            pendingJarRemovals.set(serial, jars)
          }),
      ])
      connections.delete(serial)
    })()
    return entry.closing
  }

  const closeConnection = async (serial) => {
    const entry = connections.get(serial)
    if (entry) await closeEntry(entry)
  }

  const closeAll = async () => {
    stopped = true
    await Promise.all(Array.from(connections.values(), closeEntry))
  }

  const openConnection = async (entry) => {
    const { serial, controller } = entry
    const { signal } = controller
    const info = await getInstallation()
    signal.throwIfAborted()
    if (!info.adbPath || !info.serverPath || !info.scrcpyVersion) {
      throw new Error(
        "缺少 scrcpy-server 或版本信息，无法建立 scrcpy 控制通道。"
      )
    }
    if (info.scrcpyVersion !== SCRCPY_CONTROL_VERSION) {
      throw new Error(
        `轻量控制通道需要 scrcpy ${SCRCPY_CONTROL_VERSION}，当前为 ${info.scrcpyVersion}。`
      )
    }

    const { adbPath } = info
    entry.adbPath = adbPath
    const pending = pendingJarRemovals.get(serial)
    if (pending) {
      for (const path of pending) {
        signal.throwIfAborted()
        await removeJar(adbPath, serial, path)
        pending.delete(path)
      }
      pendingJarRemovals.delete(serial)
      signal.throwIfAborted()
    }

    const scidHex = randomInt(1, 0x7fffffff).toString(16).padStart(8, "0")
    const socketName = `scrcpy_${scidHex}`
    const remoteJar = `/data/local/tmp/moon-scrcpy-${randomUUID()}.jar`
    entry.remoteJar = remoteJar
    await exec(
      adbPath,
      ["-s", serial, "push", info.serverPath, remoteJar],
      20000
    )
    signal.throwIfAborted()

    entry.socketName = socketName
    const port = Number(
      await exec(
        adbPath,
        ["-s", serial, "forward", "tcp:0", `localabstract:${socketName}`],
        8000
      )
    )
    signal.throwIfAborted()
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("ADB 未返回有效的 scrcpy 转发端口。")
    }

    const serverCommand = [
      `CLASSPATH=${remoteJar}`,
      "app_process",
      "/",
      "com.genymobile.scrcpy.Server",
      SCRCPY_CONTROL_VERSION,
      `scid=${scidHex}`,
      "log_level=warn",
      "tunnel_forward=true",
      "video=false",
      "audio=false",
      "control=true",
      "cleanup=false",
      "send_device_meta=false",
      "send_dummy_byte=true",
      "clipboard_autosync=false",
    ].join(" ")
    // adbd sends SIGHUP to the shell when the ADB channel goes away.
    // Keep remote process and JAR cleanup scoped to this shell's child.
    const command = [
      `trap 'if [ -n "$pid" ]; then kill "$pid" 2>/dev/null; fi; rm -f ${remoteJar}' EXIT`,
      "trap 'exit 1' HUP INT TERM",
      `${serverCommand} & pid=$!`,
      'wait "$pid"; status=$?; pid=; exit "$status"',
    ].join("; ")
    const serverProcess = spawn(
      adbPath,
      ["-s", serial, "shell", "-T", "-n", command],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    entry.serverProcess = serverProcess
    entry.serverClosed = new Promise((resolve) =>
      serverProcess.once("close", resolve)
    )

    const serverEnded = new AbortController()
    const cleanup = () => {
      void closeEntry(entry)
    }
    serverProcess.stdout.setEncoding("utf8")
    serverProcess.stderr.setEncoding("utf8")
    let serverOutput = ""
    const collect = (chunk) => {
      serverOutput = (serverOutput + chunk).slice(-2048)
    }
    serverProcess.stdout.on("data", collect)
    serverProcess.stderr.on("data", collect)
    serverProcess.once("error", (error) => serverEnded.abort(error))
    serverProcess.once("close", (code) => {
      serverEnded.abort(new Error(`scrcpy-server 提前退出（退出码 ${code}）`))
      if (entry.socket) cleanup()
    })

    try {
      const startup = AbortSignal.any([signal, serverEnded.signal])
      let handshake
      try {
        handshake = await connectControlSocket(port, startup)
      } catch (error) {
        if (startup.aborted) throw startup.reason
        throw error
      }
      const { socket, initialRemainder } = handshake
      entry.socket = socket
      startup.throwIfAborted()
      let recvBuf = initialRemainder
      const clipboardWaiters = []
      let lastClipboard = ""

      const parseDeviceMessages = () => {
        while (recvBuf.length >= 1) {
          const type = recvBuf.readUInt8(0)
          if (type === 0) {
            if (recvBuf.length < 5) return
            const len = recvBuf.readUInt32BE(1)
            if (recvBuf.length < 5 + len) return
            const text = recvBuf.subarray(5, 5 + len).toString("utf8")
            recvBuf = recvBuf.subarray(5 + len)
            lastClipboard = text
            while (clipboardWaiters.length > 0) {
              const waiter = clipboardWaiters.shift()
              waiter.resolve(text)
            }
          } else if (type === 1) {
            if (recvBuf.length < 9) return
            recvBuf = recvBuf.subarray(9)
          } else if (type === 2) {
            if (recvBuf.length < 5) return
            const len = recvBuf.readUInt16BE(3)
            if (recvBuf.length < 5 + len) return
            recvBuf = recvBuf.subarray(5 + len)
          } else {
            recvBuf = Buffer.alloc(0)
            return
          }
        }
      }

      if (recvBuf.length > 0) parseDeviceMessages()

      socket.on("data", (chunk) => {
        recvBuf = Buffer.concat([recvBuf, chunk])
        parseDeviceMessages()
      })

      socket.once("close", cleanup)
      socket.once("error", cleanup)
      if (socket.destroyed) throw new Error("scrcpy 控制连接已断开")
      socket.resume()

      const writeBuf = (buf) =>
        new Promise((resolve, reject) => {
          if (socket.destroyed) {
            reject(new Error("scrcpy 控制连接已断开"))
            return
          }
          socket.write(buf, (err) => (err ? reject(err) : resolve()))
        })

      return {
        writeBuf,
        requestClipboard: async () => {
          const waitPromise = new Promise((resolve) => {
            const timer = setTimeout(() => {
              const idx = clipboardWaiters.findIndex(
                (w) => w.resolve === wrapped
              )
              if (idx >= 0) clipboardWaiters.splice(idx, 1)
              resolve(lastClipboard)
            }, 600)
            const wrapped = (text) => {
              clearTimeout(timer)
              resolve(text)
            }
            clipboardWaiters.push({ resolve: wrapped })
          })
          await writeBuf(msgGetClipboard(0))
          return waitPromise
        },
      }
    } catch (error) {
      const detail = serverOutput.trim()
      if (!detail || signal.aborted) throw error
      throw new Error(`${error.message} (${detail})`, { cause: error })
    }
  }

  const getConnection = async (serial, signal) => {
    signal?.throwIfAborted()
    let entry = connections.get(serial)
    if (entry?.closing) {
      await waitForRequest(entry.closing, signal)
      return getConnection(serial, signal)
    }
    if (stopped) throw new Error("scrcpy 控制连接池已停止。")
    if (!entry) {
      entry = { serial, controller: new AbortController(), users: 0 }
      connections.set(serial, entry)
      entry.ready = openConnection(entry)
      void entry.ready.catch(() => closeEntry(entry))
    }
    return entry
  }

  const useConnection = async (serial, signal, action) => {
    const entry = await getConnection(serial, signal)
    clearTimeout(entry.idleTimer)
    entry.users += 1
    try {
      const conn = await waitForRequest(entry.ready, signal)
      const operation = (entry.lastOperation || Promise.resolve()).then(
        async () => {
          signal?.throwIfAborted()
          entry.controller.signal.throwIfAborted()
          const value = await action(conn)
          signal?.throwIfAborted()
          return value
        }
      )
      entry.lastOperation = operation.catch(() => {})
      return await operation
    } finally {
      entry.users -= 1
      if (!entry.users && !entry.closing) {
        entry.idleTimer = setTimeout(() => void closeEntry(entry), IDLE_MS)
        entry.idleTimer.unref()
      }
    }
  }

  const withFallback = async (serial, signal, scrcpyFn, adbFallbackFn) => {
    try {
      await useConnection(serial, signal, scrcpyFn)
      return { transport: "scrcpy-control" }
    } catch (error) {
      signal?.throwIfAborted()
      if (stopped || !adbFallbackFn) throw error
      await adbFallbackFn()
      return {
        transport: "adb-fallback",
        fallbackReason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    closeConnection,
    closeAll,
    tap: async (serial, x, y, screen, signal) =>
      withFallback(
        serial,
        signal,
        async (conn) => {
          await conn.writeBuf(
            msgInjectTouch(ACTION_DOWN, x, y, screen.width, screen.height)
          )
          await sleep(30)
          await conn.writeBuf(
            msgInjectTouch(ACTION_UP, x, y, screen.width, screen.height)
          )
        },
        () => adb.fallbackTap(serial, x, y, signal)
      ),
    longPress: async (serial, x, y, durationMs, screen, signal) =>
      withFallback(
        serial,
        signal,
        async (conn) => {
          await conn.writeBuf(
            msgInjectTouch(ACTION_DOWN, x, y, screen.width, screen.height)
          )
          await sleep(Math.max(300, Math.min(3000, durationMs || 650)))
          await conn.writeBuf(
            msgInjectTouch(ACTION_UP, x, y, screen.width, screen.height)
          )
        },
        () =>
          adb.fallbackSwipe(
            serial,
            x,
            y,
            x,
            y,
            Math.max(300, Math.min(3000, durationMs || 650)),
            signal
          )
      ),
    swipe: async (serial, x1, y1, x2, y2, durationMs, screen, signal) =>
      withFallback(
        serial,
        signal,
        async (conn) => {
          const totalMs = Math.max(80, Math.min(3000, durationMs || 260))
          const steps = Math.max(6, Math.min(30, Math.round(totalMs / 16)))
          await conn.writeBuf(
            msgInjectTouch(ACTION_DOWN, x1, y1, screen.width, screen.height)
          )
          for (let i = 1; i <= steps; i++) {
            await sleep(totalMs / steps)
            const t = i / steps
            const cx = x1 + (x2 - x1) * t
            const cy = y1 + (y2 - y1) * t
            await conn.writeBuf(
              msgInjectTouch(ACTION_MOVE, cx, cy, screen.width, screen.height)
            )
          }
          await conn.writeBuf(
            msgInjectTouch(ACTION_UP, x2, y2, screen.width, screen.height)
          )
        },
        () =>
          adb.fallbackSwipe(serial, x1, y1, x2, y2, durationMs || 260, signal)
      ),
    scroll: async (serial, x, y, hScroll, vScroll, screen, signal) =>
      withFallback(
        serial,
        signal,
        async (conn) => {
          await conn.writeBuf(
            msgInjectScroll(x, y, screen.width, screen.height, hScroll, vScroll)
          )
        },
        null
      ),
    injectText: async (serial, text, signal) =>
      withFallback(
        serial,
        signal,
        async (conn) => {
          for (const chunk of splitUtf8Text(text)) {
            await conn.writeBuf(msgInjectTextChunk(chunk))
            await sleep(15)
          }
        },
        () => adb.fallbackText(serial, text, signal)
      ),
    key: async (serial, keyName, signal) => {
      const code = ANDROID_KEYCODES[keyName]
      if (!code) throw new Error(`不支持的按键：${keyName}`)
      return withFallback(
        serial,
        signal,
        async (conn) => {
          await conn.writeBuf(msgInjectKeycode(ACTION_DOWN, code))
          await sleep(20)
          await conn.writeBuf(msgInjectKeycode(ACTION_UP, code))
        },
        () => adb.fallbackKeyevent(serial, code, signal)
      )
    },
    setDisplayPower: async (serial, on, signal) =>
      withFallback(
        serial,
        signal,
        async (conn) => {
          await conn.writeBuf(msgSetDisplayPower(on))
        },
        async () => {
          if (on) {
            await adb.fallbackKeyevent(serial, 224, signal)
          } else {
            await adb.fallbackKeyevent(serial, 223, signal)
          }
        }
      ),
    backOrScreenOn: async (serial, signal) =>
      withFallback(
        serial,
        signal,
        async (conn) => {
          await conn.writeBuf(msgBackOrScreenOn(ACTION_DOWN))
          await sleep(20)
          await conn.writeBuf(msgBackOrScreenOn(ACTION_UP))
        },
        () => adb.fallbackKeyevent(serial, ANDROID_KEYCODES.back, signal)
      ),
    expandNotifications: async (serial, signal) =>
      withFallback(
        serial,
        signal,
        async (conn) => {
          await conn.writeBuf(msgEmpty(TYPE_EXPAND_NOTIFICATION_PANEL))
        },
        () =>
          adb.execAdb(
            ["-s", serial, "shell", "cmd", "statusbar", "expand-notifications"],
            {
              signal,
            }
          )
      ),
    collapsePanels: async (serial, signal) =>
      withFallback(
        serial,
        signal,
        async (conn) => {
          await conn.writeBuf(msgEmpty(TYPE_COLLAPSE_PANELS))
        },
        () =>
          adb.execAdb(["-s", serial, "shell", "cmd", "statusbar", "collapse"], {
            signal,
          })
      ),
    rotate: async (serial, signal) =>
      withFallback(
        serial,
        signal,
        async (conn) => {
          await conn.writeBuf(msgEmpty(TYPE_ROTATE_DEVICE))
        },
        null
      ),
    startApp: async (serial, packageName, signal) =>
      withFallback(
        serial,
        signal,
        async (conn) => {
          await conn.writeBuf(msgStartApp(packageName))
        },
        () => adb.launchApp(serial, packageName, signal)
      ),
    getClipboard: async (serial, signal) => {
      const text = await useConnection(serial, signal, (conn) =>
        conn.requestClipboard()
      )
      return { text, transport: "scrcpy-control" }
    },
    setClipboard: async (serial, text, paste, signal) => {
      await useConnection(serial, signal, (conn) =>
        conn.writeBuf(msgSetClipboard(Date.now(), text, Boolean(paste)))
      )
      return { transport: "scrcpy-control" }
    },
  }
}
