import { parseUiTreeXml } from "./ui-tree.mjs"

export function diagnoseAdbError(message) {
  const text = String(message || "")
  if (/unauthorized/i.test(text)) {
    return "设备未授权 USB 调试：请在手机屏幕上勾选「一律允许」并确认授权弹窗。"
  }
  if (/INJECT_EVENTS/i.test(text)) {
    return "系统拒绝注入输入事件（INJECT_EVENTS）：小米/红米等设备请在开发者选项中开启「USB 调试（安全设置）」并重启手机。"
  }
  if (/offline/i.test(text)) {
    return "设备处于离线状态（offline）：请重新插拔数据线或重连无线调试。"
  }
  if (
    /device\s+['"]?[^'"]+['"]?\s+not found|no devices\/emulators found/i.test(
      text
    )
  ) {
    return "未找到目标设备：请确认设备已连接且在设备列表中处于在线状态。"
  }
  return text.trim() || "ADB 执行失败。"
}

function parseDevicesLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("List of devices")) return null
  const parts = trimmed.split(/\s+/)
  if (parts.length < 2) return null
  const serial = parts[0]
  const rawState = parts[1]
  const state =
    rawState === "device" ||
    rawState === "unauthorized" ||
    rawState === "offline"
      ? rawState
      : "unknown"
  let model = ""
  for (const token of parts.slice(2)) {
    if (token.startsWith("model:")) {
      model = token.slice(6).replace(/_/g, " ")
    }
  }
  const transport = serial.includes(":") ? "tcpip" : "usb"
  return {
    serial,
    state,
    transport,
    model,
  }
}

export function createAdbClient({ run, runBinary, getAdbPath }) {
  const execAdb = async (args, options = {}) => {
    const adbPath = getAdbPath()
    if (!adbPath) {
      throw new Error("未检测到可用的 adb，请先安装 scrcpy/ADB 或配置路径。")
    }
    const res = await run(adbPath, args, {
      timeoutMs: options.timeoutMs ?? 20000,
      signal: options.signal,
      label: options.label || `adb ${args[0] || ""}`.trim(),
    })
    if (res.code !== 0 && !options.allowFailure) {
      throw new Error(diagnoseAdbError(res.stderr || res.stdout))
    }
    return res
  }

  const execAdbBinary = async (args, options = {}) => {
    const adbPath = getAdbPath()
    if (!adbPath) {
      throw new Error("未检测到可用的 adb，请先安装 scrcpy/ADB 或配置路径。")
    }
    const res = await runBinary(adbPath, args, {
      timeoutMs: options.timeoutMs ?? 20000,
      signal: options.signal,
      label: options.label || "adb binary",
    })
    if (res.code !== 0) {
      throw new Error(diagnoseAdbError(res.stderr?.toString("utf8") || ""))
    }
    return res.stdout
  }

  const listDevices = async (signal) => {
    const res = await execAdb(["devices", "-l"], { signal, timeoutMs: 8000 })
    const raw = res.stdout.split(/\r?\n/).map(parseDevicesLine).filter(Boolean)

    const enriched = await Promise.all(
      raw.map(async (item) => {
        if (item.state !== "device") {
          return {
            ...item,
            model: item.model || item.serial,
            androidVersion: "",
            issue:
              item.state === "unauthorized"
                ? "请在手机端确认「允许 USB 调试」授权弹窗。"
                : item.state === "offline"
                  ? "设备离线，请重新插拔或重连。"
                  : `设备状态异常（${item.state}）。`,
          }
        }
        try {
          const propsRes = await execAdb(
            [
              "-s",
              item.serial,
              "shell",
              "getprop ro.product.model && getprop ro.build.version.release",
            ],
            { signal, timeoutMs: 5000, allowFailure: true }
          )
          const lines = propsRes.stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
          return {
            ...item,
            model: lines[0] || item.model || item.serial,
            androidVersion: lines[1] || "",
            issue: "",
          }
        } catch {
          return {
            ...item,
            model: item.model || item.serial,
            androidVersion: "",
            issue: "",
          }
        }
      })
    )
    return enriched
  }

  const getScreenSize = async (serial, signal) => {
    const sizeRes = await execAdb(["-s", serial, "shell", "wm", "size"], {
      signal,
      timeoutMs: 5000,
      allowFailure: true,
    })
    const overrideMatch = sizeRes.stdout.match(/Override size:\s*(\d+)x(\d+)/i)
    const physicalMatch = sizeRes.stdout.match(/Physical size:\s*(\d+)x(\d+)/i)
    const match = overrideMatch || physicalMatch
    let width = match ? Number(match[1]) : 1080
    let height = match ? Number(match[2]) : 2400

    const rotRes = await execAdb(
      ["-s", serial, "shell", "dumpsys input | grep SurfaceOrientation"],
      { signal, timeoutMs: 5000, allowFailure: true }
    )
    const rotMatch = rotRes.stdout.match(/SurfaceOrientation:\s*(\d)/)
    const rotation = rotMatch ? Number(rotMatch[1]) : 0
    if ((rotation === 1 || rotation === 3) && width < height) {
      ;[width, height] = [height, width]
    } else if ((rotation === 0 || rotation === 2) && width > height) {
      // Keep physical aspect unless device reports landscape natively; only swap when needed
    }
    return { width, height, rotation }
  }

  const getDeviceInfo = async (serial, signal) => {
    const [propsRes, screen, batteryRes, topRes] = await Promise.all([
      execAdb(
        [
          "-s",
          serial,
          "shell",
          "getprop ro.product.manufacturer && getprop ro.product.model && getprop ro.build.version.release && getprop ro.build.version.sdk",
        ],
        { signal, timeoutMs: 5000, allowFailure: true }
      ),
      getScreenSize(serial, signal),
      execAdb(["-s", serial, "shell", "dumpsys battery"], {
        signal,
        timeoutMs: 5000,
        allowFailure: true,
      }),
      execAdb(
        [
          "-s",
          serial,
          "shell",
          "dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity'",
        ],
        { signal, timeoutMs: 5000, allowFailure: true }
      ),
    ])

    const props = propsRes.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const batteryLevelMatch = batteryRes.stdout.match(/level:\s*(\d+)/i)
    const batteryLevel = batteryLevelMatch ? Number(batteryLevelMatch[1]) : null
    const topMatch = topRes.stdout.match(/([a-zA-Z0-9_.]+\/[a-zA-Z0-9_.]+)/)
    const foregroundApp = topMatch ? topMatch[1] : ""

    return {
      serial,
      manufacturer: props[0] || "",
      model: props[1] || serial,
      androidVersion: props[2] || "",
      sdk: props[3] ? Number(props[3]) : null,
      screenWidth: screen.width,
      screenHeight: screen.height,
      rotation: screen.rotation,
      batteryLevel,
      foregroundApp,
    }
  }

  const screenshot = async (serial, signal) => {
    const buffer = await execAdbBinary(
      ["-s", serial, "exec-out", "screencap", "-p"],
      { signal, timeoutMs: 15000, label: "adb screencap" }
    )
    if (!buffer || buffer.length < 16) {
      throw new Error(
        "设备截图返回空数据，请检查设备是否处于锁屏或受保护界面。"
      )
    }
    return buffer
  }

  const dumpUiTree = async (serial, options = {}, signal) => {
    const dumpArgs = [
      "-s",
      serial,
      "shell",
      "uiautomator",
      "dump",
      "/data/local/tmp/moon-ui.xml",
    ]
    let dumpRes = await execAdb(dumpArgs, {
      signal,
      timeoutMs: 12000,
      allowFailure: true,
    })
    if (
      dumpRes.code !== 0 ||
      /could not get idle state|ERROR:/i.test(dumpRes.stdout + dumpRes.stderr)
    ) {
      dumpRes = await execAdb(
        [
          "-s",
          serial,
          "shell",
          "uiautomator",
          "dump",
          "--compressed",
          "/data/local/tmp/moon-ui.xml",
        ],
        { signal, timeoutMs: 12000, allowFailure: true }
      )
    }
    const xmlBuf = await execAdbBinary(
      ["-s", serial, "exec-out", "cat", "/data/local/tmp/moon-ui.xml"],
      { signal, timeoutMs: 8000, label: "读取 UI 控件树" }
    )
    const xml = xmlBuf.toString("utf8")
    if (!xml.includes("<hierarchy")) {
      throw new Error(
        diagnoseAdbError(
          dumpRes.stderr || dumpRes.stdout || "无法获取当前界面的 UI 控件树。"
        )
      )
    }
    return parseUiTreeXml(xml, options)
  }

  const listApps = async (serial, options = {}, signal) => {
    const includeSystem = Boolean(options.includeSystem)
    const filter = String(options.query || "")
      .trim()
      .toLowerCase()
    const args = ["-s", serial, "shell", "pm", "list", "packages"]
    if (!includeSystem) args.push("-3")
    const res = await execAdb(args, { signal, timeoutMs: 10000 })
    let packages = res.stdout
      .split(/\r?\n/)
      .map((line) => line.replace(/^package:/, "").trim())
      .filter(Boolean)
    if (filter) {
      packages = packages.filter((pkg) => pkg.toLowerCase().includes(filter))
    }
    packages.sort()
    return packages.slice(0, options.limit ?? 150)
  }

  const connectWireless = async (address, signal) => {
    const target = String(address || "").trim()
    if (!target) throw new Error("请输入设备 IP:端口。")
    const normalized = target.includes(":") ? target : `${target}:5555`
    const res = await execAdb(["connect", normalized], {
      signal,
      timeoutMs: 15000,
    })
    const out = (res.stdout || res.stderr || "").trim()
    const ok = /connected to|already connected/i.test(out)
    if (!ok) throw new Error(out || `无法连接到 ${normalized}`)
    return { ok: true, serial: normalized, message: out }
  }

  const pairWireless = async (address, pairingCode, signal) => {
    const target = String(address || "").trim()
    const code = String(pairingCode || "").trim()
    if (!target || !code) {
      throw new Error("请输入配对 IP:端口 与 6 位配对码。")
    }
    const res = await execAdb(["pair", target, code], {
      signal,
      timeoutMs: 15000,
    })
    const out = (res.stdout || res.stderr || "").trim()
    if (!/successfully paired/i.test(out)) {
      throw new Error(out || "无线调试配对失败。")
    }
    return { ok: true, message: out }
  }

  const getDeviceIp = async (serial, signal) => {
    const routeRes = await execAdb(["-s", serial, "shell", "ip", "route"], {
      signal,
      timeoutMs: 5000,
      allowFailure: true,
    })
    const match = routeRes.stdout.match(/src\s+(\d+\.\d+\.\d+\.\d+)/)
    if (match) return match[1]
    const wlanRes = await execAdb(
      ["-s", serial, "shell", "ip -f inet addr show wlan0"],
      { signal, timeoutMs: 5000, allowFailure: true }
    )
    const wlanMatch = wlanRes.stdout.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/)
    return wlanMatch ? wlanMatch[1] : null
  }

  const enableTcpip = async (serial, port = 5555, signal) => {
    const ip = await getDeviceIp(serial, signal)
    if (!ip) {
      throw new Error(
        "未获取到设备 Wi-Fi IP，请确认手机已连接同一局域网 Wi-Fi。"
      )
    }
    await execAdb(["-s", serial, "tcpip", String(port)], {
      signal,
      timeoutMs: 10000,
    })
    await new Promise((r) => setTimeout(r, 1200))
    const address = `${ip}:${port}`
    const connected = await connectWireless(address, signal)
    return { ok: connected.ok, address }
  }

  const disconnectWireless = async (serial, signal) => {
    await execAdb(["disconnect", serial], { signal, timeoutMs: 8000 })
    return { ok: true }
  }

  const installApk = async (serial, apkPath, signal) => {
    const res = await execAdb(["-s", serial, "install", "-r", apkPath], {
      signal,
      timeoutMs: 120000,
    })
    const out = (res.stdout || "").trim()
    if (!/Success/i.test(out)) {
      throw new Error(out || "APK 安装失败。")
    }
    return out
  }

  const pushFile = async (serial, localPath, remotePath, signal) => {
    await execAdb(["-s", serial, "push", localPath, remotePath], {
      signal,
      timeoutMs: 120000,
    })
  }

  const pullFile = async (serial, remotePath, localPath, signal) => {
    await execAdb(["-s", serial, "pull", remotePath, localPath], {
      signal,
      timeoutMs: 120000,
    })
  }

  const stopApp = async (serial, packageName, signal) => {
    await execAdb(["-s", serial, "shell", "am", "force-stop", packageName], {
      signal,
      timeoutMs: 8000,
    })
  }

  const launchApp = async (serial, packageName, signal) => {
    const res = await execAdb(
      [
        "-s",
        serial,
        "shell",
        "monkey",
        "-p",
        packageName,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ],
      { signal, timeoutMs: 8000, allowFailure: true }
    )
    if (res.code !== 0) {
      throw new Error(res.stderr || res.stdout || `无法启动应用 ${packageName}`)
    }
  }

  const fallbackTap = async (serial, x, y, signal) => {
    await execAdb(
      ["-s", serial, "shell", "input", "tap", String(x), String(y)],
      {
        signal,
        timeoutMs: 8000,
      }
    )
  }

  const fallbackSwipe = async (serial, x1, y1, x2, y2, durationMs, signal) => {
    await execAdb(
      [
        "-s",
        serial,
        "shell",
        "input",
        "swipe",
        String(x1),
        String(y1),
        String(x2),
        String(y2),
        String(durationMs),
      ],
      { signal, timeoutMs: 10000 }
    )
  }

  const fallbackKeyevent = async (serial, keycode, signal) => {
    await execAdb(
      ["-s", serial, "shell", "input", "keyevent", String(keycode)],
      { signal, timeoutMs: 8000 }
    )
  }

  const fallbackText = async (serial, text, signal) => {
    if (/[^\x20-\x7e]/.test(text)) {
      throw new Error(
        "当前处于 ADB 降级模式，adb shell input text 不支持中文或非 ASCII 字符；请确保 scrcpy-server 控制通道可用。"
      )
    }
    const escaped = text.replace(/([\\ "'`$&|;()<>?*~])/g, "\\$1")
    await execAdb(["-s", serial, "shell", "input", "text", escaped], {
      signal,
      timeoutMs: 10000,
    })
  }

  return {
    execAdb,
    listDevices,
    getScreenSize,
    getDeviceInfo,
    screenshot,
    dumpUiTree,
    listApps,
    connectWireless,
    pairWireless,
    enableTcpip,
    disconnectWireless,
    installApk,
    pushFile,
    pullFile,
    stopApp,
    launchApp,
    fallbackTap,
    fallbackSwipe,
    fallbackKeyevent,
    fallbackText,
  }
}
