import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, lstat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createElement, useRef } from "react"
import { renderToString } from "react-dom/server"
import { createServer } from "vite"
import react from "@vitejs/plugin-react"

let server,
  cache,
  SelectedMaterials,
  MaterialRailNavigation,
  HomeComposer,
  ConversationComposer,
  TooltipProvider,
  prepareImageUpload,
  appendPreparedMaterials,
  createMaterialService,
  uploadRetrySources,
  draftStore,
  MaterialServiceContext,
  useComposerMaterials,
  MaterialThumbnail,
  MaterialImagePreview,
  readMaterialThumbnail,
  ToolCall
test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-material-rail-ui-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    plugins: [react()],
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  ;({ SelectedMaterials, MaterialRailNavigation } = await server.ssrLoadModule(
    "/src/features/home/selected-materials.tsx",
  ))
  ;({ MaterialServiceContext, appendPreparedMaterials, createMaterialService } =
    await server.ssrLoadModule("/src/features/materials/material-service.ts"))
  ;({ useComposerMaterials } = await server.ssrLoadModule(
    "/src/features/materials/use-composer-materials.ts",
  ))
  ;({ HomeComposer } = await server.ssrLoadModule(
    "/src/features/home/home-composer.tsx",
  ))
  ;({ ConversationComposer } = await server.ssrLoadModule(
    "/src/features/conversation/composer/conversation-composer.tsx",
  ))
  ;({ TooltipProvider } = await server.ssrLoadModule(
    "/src/components/ui/tooltip.tsx",
  ))
  ;({ prepareImageUpload } = await server.ssrLoadModule(
    "/src/features/materials/prepare-image-upload.ts",
  ))
  draftStore = await server.ssrLoadModule(
    "/src/features/conversation/conversation-draft-store.ts",
  )
  uploadRetrySources = await server.ssrLoadModule(
    "/src/features/materials/upload-retry-sources.ts",
  )
  ;({ MaterialThumbnail } = await server.ssrLoadModule(
    "/src/features/materials/material-thumbnail.tsx",
  ))
  ;({ MaterialImagePreview } = await server.ssrLoadModule(
    "/src/features/materials/material-image-preview.tsx",
  ))
  ;({ readMaterialThumbnail } = await server.ssrLoadModule(
    "/src/features/materials/material-thumbnail-reader.ts",
  ))
  ;({ ToolCall } = await server.ssrLoadModule(
    "/src/features/conversation/messages/tool-call.tsx",
  ))
})

test.after(async () => {
  await server?.close()
  if (!cache) return
  assert.equal(dirname(resolve(cache)), resolve(tmpdir()))
  assert.ok(basename(cache).startsWith("moon-material-rail-ui-"))
  assert.equal((await lstat(cache)).isSymbolicLink(), false)
  await rm(cache, { recursive: true, force: true })
})

// These real SSR renders check recovery semantics and accessible actions. They
// do not execute effects, measure layout or prove DOM focus/scroll behaviour;
// those boundaries remain part of the formal-page browser acceptance.
function renderMaterials(raw, display = raw) {
  const service = {
    restore: async () => {
      throw new Error("SSR must not call services")
    },
  }
  function Probe() {
    const controller = useComposerMaterials({
      sessionId: "home-recovery",
      cwd: "H:/workspace/moon",
      anchorRef: useRef(null),
      materials: raw,
      update: () => {},
    })
    return createElement(SelectedMaterials, {
      materials: display,
      onRemove: () => {},
      onRetry: (id) => {
        void controller.retry(id)
      },
      canRetry: (item) => controller.canRetry(item.id),
      retryLabel: (item) => controller.retryLabel(item.id),
    })
  }
  return renderToString(
    createElement(
      MaterialServiceContext.Provider,
      { value: service },
      createElement(Probe),
    ),
  )
}

test("a failed authority file offers one explicit recheck and retains its removal action", () => {
  const html = renderMaterials([
    {
      id: "a".repeat(64),
      name: "README.md",
      kind: "附件",
      type: "file",
      status: "failed",
      source: "H:/workspace/moon/README.md",
      error: "目录暂时不可读。",
    },
  ])
  assert.match(html, /aria-label="重新检查 README.md"/)
  assert.match(html, /aria-label="移除README.md"/)
  assert.doesNotMatch(html, /aria-label="预览 README.md"/)
  assert.match(html, /目录暂时不可读。/)
})

for (const page of ["home", "conversation"]) {
  for (const status of ["ready", "failed"]) {
    test(`${page}: ${status} image with an incompatible model cannot offer a material retry`, () => {
      const material = {
        id: "b".repeat(64),
        name: "设计稿.png",
        kind: "附件",
        type: "image",
        status,
        source: "粘贴图片",
        ...(status === "failed"
          ? { error: "缓存暂时无法读取。", retryable: true }
          : {}),
      }
      const draft = {
        sessionId: "home-recovery",
        workspaceId: "workspace",
        text: "检查设计稿",
        model: "text-model",
        thinking: "",
        materials: [material],
        session: { toolIds: [], instructionScope: "all" },
      }
      const data = {
        workspaces: [
          { id: "workspace", name: "moon", path: "H:/workspace/moon" },
        ],
        models: ["text-model"],
        modelInputs: { "text-model": ["text"] },
        materials: [],
        tools: [],
      }
      const service = {
        restore: async () => {
          throw new Error("SSR must not call services")
        },
      }
      const component =
        page === "home"
          ? createElement(HomeComposer, {
              data,
              initialDraft: draft,
              onSubmit: () => "accepted",
            })
          : createElement(ConversationComposer, {
              data,
              draft,
              sessionId: draft.sessionId,
              workspacePath: "H:/workspace/moon",
              onChange: () => {},
              onSubmit: () => {},
              onStop: () => {},
            })
      const html = renderToString(
        createElement(
          TooltipProvider,
          null,
          createElement(
            MaterialServiceContext.Provider,
            { value: service },
            component,
          ),
        ),
      )
      assert.doesNotMatch(html, /aria-label="(?:重新检查|重试准备)/)
      assert.doesNotMatch(html, /aria-label="预览/)
      assert.match(html, /当前模型不支持图片/)
      assert.match(html, /aria-label="移除设计稿.png"/)
    })
  }
}

test("authority-rejected fixed image content cannot expose a futile retry", () => {
  const materials = [
    {
      id: "c".repeat(64),
      name: "坏图.png",
      kind: "附件",
      type: "image",
      status: "failed",
      source: "粘贴图片",
      retryable: false,
      error: "保存的图片内容损坏，请重新选择。",
    },
  ]
  const html = renderMaterials(materials)
  const direct = renderToString(
    createElement(SelectedMaterials, {
      materials,
      onRemove: () => {},
      onRetry: () => {},
    }),
  )
  for (const content of [html, direct]) {
    assert.doesNotMatch(content, /aria-label="(?:重新检查|重试准备)/)
    assert.match(content, /aria-label="移除坏图.png"/)
  }
})

test("re-selecting repaired fixed content upgrades only its failed matching authority identity", () => {
  const before = {
    id: "first",
    name: "before.md",
    kind: "附件",
    status: "ready",
  }
  const failed = {
    id: "d".repeat(64),
    name: "截图.png",
    kind: "附件",
    type: "image",
    status: "failed",
    source: "粘贴图片",
    error: "缓存损坏。",
    retryable: false,
  }
  const later = { id: "later", name: "later.md", kind: "附件", status: "ready" }
  const repaired = {
    id: failed.id,
    name: failed.name,
    kind: failed.kind,
    type: "image",
    status: "ready",
    source: failed.source,
  }
  const result = appendPreparedMaterials([before, failed, later], [repaired])
  assert.deepEqual(result, [before, repaired, later])
  assert.equal(result[0], before)
  assert.equal(result[2], later)
  assert.equal(
    appendPreparedMaterials(result, [{ ...repaired, name: "other draft" }])[1],
    repaired,
  )
  assert.equal(failed.status, "failed")
})

test("authority recovery metadata survives both draft caches while image thumbnails stay local", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const values = new Map()
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size
      },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous)
    else delete globalThis.localStorage
  })
  const draft = {
    workspaceId: "recovery",
    sessionId: "recovery",
    text: "待继续",
    model: "model",
    thinking: "",
    session: { toolIds: [], instructionScope: "all" },
    materials: [
      {
        id: "e".repeat(64),
        name: "坏图.png",
        kind: "附件",
        type: "image",
        status: "failed",
        source: "粘贴图片",
        retryable: false,
        thumbnail: "local-preview",
      },
    ],
  }
  draftStore.saveHomeDraft(draft)
  draftStore.saveConversationDraft("recovery", draft)
  for (const restored of [
    draftStore.restoreHomeDraft("recovery"),
    draftStore.restoreConversationDrafts().drafts.recovery,
  ]) {
    assert.equal(restored.materials[0].retryable, false)
    assert.equal("thumbnail" in restored.materials[0], false)
  }
})

test("browser file failures without a real source do not expose a futile retry", () => {
  const html = renderMaterials([
    {
      id: "preparing:browser-file",
      name: "notes.txt",
      kind: "附件",
      type: "file",
      status: "failed",
      source: "浏览器拖入的文件",
      error: "缺少实际路径，请重新选择。",
    },
  ])
  assert.doesNotMatch(html, /aria-label="(?:重新检查|重试准备)/)
  assert.match(html, /aria-label="移除notes.txt"/)
})

test("preparation remains removable and cannot trigger a premature preview", () => {
  const html = renderMaterials([
    {
      id: "preparing:image",
      name: "截图.png",
      kind: "附件",
      type: "image",
      status: "preparing",
      source: "粘贴图片",
    },
  ])
  assert.match(html, /正在准备/)
  assert.match(html, /aria-label="移除截图.png"/)
  assert.doesNotMatch(html, /aria-label="(?:重新检查|重试准备|预览)/)
})

test("cancelling during FileReader work aborts reading and never starts an upload", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "FileReader")
  const readers = []
  class ControlledFileReader {
    result = "data:image/png;base64,eA=="
    onload = null
    onerror = null
    onabort = null
    aborted = false
    constructor() {
      readers.push(this)
    }
    readAsDataURL() {
      /* Deliberately wait at the real asynchronous boundary. */
    }
    abort() {
      this.aborted = true
      this.onabort?.()
    }
  }
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: ControlledFileReader,
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "FileReader", previous)
    else delete globalThis.FileReader
  })
  let uploads = 0
  const service = {
    upload: async () => {
      uploads++
      return {}
    },
  }
  const controller = new AbortController()
  const result = prepareImageUpload({
    service,
    sessionId: "scope-a",
    cwd: "H:/workspace/moon",
    file: new File(["x"], "截图.png", { type: "image/png" }),
    name: "截图.png",
    signal: controller.signal,
  })
  assert.equal(readers.length, 1)
  // This controller belongs to the original operation even if the UI returns
  // to scope A after visiting B; a repeated scope string cannot renew it.
  controller.abort()
  await assert.rejects(result, { name: "AbortError" })
  assert.equal(readers[0].aborted, true)
  readers[0].onload?.()
  assert.equal(uploads, 0)
})

test("a handed-off failed upload exposes the actual conversation retry and uploads its retained File once", async (t) => {
  const sid = "handoff-session"
  const cwd = "H:/workspace/moon"
  const id = "preparing:handoff-upload"
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==",
    "base64",
  )
  const file = new File([bytes], "下一项设计.png", { type: "image/png" })
  const original = {
    id,
    name: file.name,
    kind: "附件",
    type: "image",
    status: "failed",
    source: "粘贴或拖入的图片",
    retryable: true,
    error: "本地存储暂时不可写。",
  }
  let current = [original]
  const calls = []
  const service = {
    prepare: async () => {
      throw new Error("an upload must not reread a path")
    },
    restore: async () => {
      throw new Error("a local upload must not restore a host identity")
    },
    upload: async (sessionId, path, input, signal) => {
      signal.throwIfAborted()
      calls.push({ sessionId, path, input })
      return {
        id: "a".repeat(64),
        name: input.name,
        kind: "附件",
        type: "image",
        status: "ready",
        source: "粘贴或拖入的图片",
        mimeType: "image/png",
        bytes: bytes.length,
      }
    },
  }
  const {
    rememberUploadRetrySource,
    getUploadRetrySource,
    releaseUploadRetrySource,
  } = uploadRetrySources
  rememberUploadRetrySource(service, sid, cwd, id, file)
  t.after(() => releaseUploadRetrySource(service, sid, cwd, id))
  const draft = {
    sessionId: sid,
    workspaceId: "workspace",
    text: "下一项任务",
    model: "image-model",
    thinking: "",
    materials: current,
    session: { toolIds: [], instructionScope: "all" },
  }
  const data = {
    workspaces: [{ id: "workspace", name: "moon", path: cwd }],
    models: ["image-model"],
    modelInputs: { "image-model": ["text", "image"] },
    materials: [],
    tools: [],
  }
  const html = renderToString(
    createElement(
      TooltipProvider,
      null,
      createElement(
        MaterialServiceContext.Provider,
        { value: service },
        createElement(ConversationComposer, {
          data,
          draft,
          sessionId: sid,
          workspacePath: cwd,
          onChange: () => {},
          onSubmit: () => {},
          onStop: () => {},
        }),
      ),
    ),
  )
  assert.match(html, /aria-label="重试准备 下一项设计.png"/)
  assert.match(html, /aria-label="移除下一项设计.png"/)
  assert.doesNotMatch(JSON.stringify(draft), /iVBOR|File|arrayBuffer/)
  let controller
  function RetryProbe() {
    controller = useComposerMaterials({
      sessionId: sid,
      cwd,
      materials: current,
      anchorRef: useRef(null),
      update: (apply) => {
        current = apply(current)
      },
    })
    return null
  }
  renderToString(
    createElement(
      MaterialServiceContext.Provider,
      { value: service },
      createElement(RetryProbe),
    ),
  )
  assert.equal(controller.canRetry(id), true)
  const previousReader = Object.getOwnPropertyDescriptor(
    globalThis,
    "FileReader",
  )
  class UploadFileReader {
    result = null
    onload = null
    onerror = null
    onabort = null
    readAsDataURL(value) {
      void value.arrayBuffer().then((data) => {
        this.result = `data:${value.type};base64,${Buffer.from(data).toString("base64")}`
        this.onload?.()
      })
    }
    abort() {
      this.onabort?.()
    }
  }
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: UploadFileReader,
  })
  t.after(() => {
    if (previousReader)
      Object.defineProperty(globalThis, "FileReader", previousReader)
    else delete globalThis.FileReader
  })
  await controller.retry(id)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].sessionId, sid)
  assert.equal(calls[0].path, cwd)
  assert.equal(calls[0].input.data, bytes.toString("base64"))
  assert.equal(current.length, 1)
  assert.equal(current[0].status, "ready")
  assert.equal(current[0].id, "a".repeat(64))
  assert.equal(getUploadRetrySource(service, sid, cwd, id), undefined)
})

test("upload retry sources isolate service, session, cwd and material identities and never attach to fixed images", (t) => {
  const service = createMaterialService()
  const substitute = createMaterialService()
  const file = new File(["x"], "image.png", { type: "image/png" })
  const sid = "session-a",
    cwd = "H:/workspace/a",
    id = "preparing:upload-a"
  const {
    rememberUploadRetrySource,
    getUploadRetrySource,
    releaseUploadRetrySource,
  } = uploadRetrySources
  rememberUploadRetrySource(service, sid, cwd, id, file)
  t.after(() => releaseUploadRetrySource(service, sid, cwd, id))
  assert.equal(getUploadRetrySource(service, sid, cwd, id), file)
  assert.equal(getUploadRetrySource(substitute, sid, cwd, id), undefined)
  assert.equal(getUploadRetrySource(service, "session-b", cwd, id), undefined)
  assert.equal(
    getUploadRetrySource(service, sid, "H:/workspace/b", id),
    undefined,
  )
  assert.equal(
    getUploadRetrySource(service, sid, cwd, "preparing:another"),
    undefined,
  )
  rememberUploadRetrySource(service, sid, cwd, "b".repeat(64), file)
  assert.equal(
    getUploadRetrySource(service, sid, cwd, "b".repeat(64)),
    undefined,
  )
  releaseUploadRetrySource(service, sid, cwd, id)
  assert.equal(getUploadRetrySource(service, sid, cwd, id), undefined)
})

test("retained upload memory covers twelve images and expires or evicts bounded candidates", (t) => {
  const service = createMaterialService()
  const sid = "bounded-session",
    cwd = "H:/workspace/moon"
  const {
    rememberUploadRetrySource,
    getUploadRetrySource,
    releaseUploadRetrySource,
    uploadRetrySourceLimits,
  } = uploadRetrySources
  const ids = []
  t.after(() => {
    for (const id of ids) releaseUploadRetrySource(service, sid, cwd, id)
  })
  const file = new File([new Uint8Array(8 * 1024 * 1024)], "large.png", {
    type: "image/png",
  })
  for (let index = 0; index < 17; index++) {
    const id = `preparing:large-${index}`
    ids.push(id)
    rememberUploadRetrySource(service, sid, cwd, id, file)
    if (index === 11)
      for (const selected of ids)
        assert.equal(getUploadRetrySource(service, sid, cwd, selected), file)
  }
  assert.equal(getUploadRetrySource(service, sid, cwd, ids[0]), undefined)
  for (const id of ids) releaseUploadRetrySource(service, sid, cwd, id)
  const small = new File(["x"], "small.png", { type: "image/png" })
  for (let index = 0; index <= uploadRetrySourceLimits.entries; index++) {
    const id = `preparing:small-${index}`
    ids.push(id)
    rememberUploadRetrySource(service, sid, cwd, id, small)
  }
  assert.equal(
    getUploadRetrySource(service, sid, cwd, "preparing:small-0"),
    undefined,
  )
  const clock = Date.now
  const expires = clock() + uploadRetrySourceLimits.lifetime + 1
  t.after(() => {
    Date.now = clock
  })
  Date.now = () => expires
  assert.equal(getUploadRetrySource(service, sid, cwd, ids.at(-1)), undefined)
})

test("temporary path-image failures retry their explicit path while fixed images only verify their identity", async () => {
  const sid = "path-image-session",
    cwd = "H:/workspace/moon"
  const path = `${cwd}/local.png`
  const calls = []
  const prepared = {
    id: "c".repeat(64),
    name: "local.png",
    kind: "附件",
    type: "image",
    status: "ready",
    source: path,
  }
  const service = {
    prepare: async (sessionId, directory, paths) => {
      calls.push({ method: "prepare", sessionId, directory, paths })
      return [prepared]
    },
    restore: async (sessionId, directory, references) => {
      calls.push({ method: "restore", sessionId, directory, references })
      return [prepared]
    },
    upload: async () => {
      throw new Error("a native path must not become an upload")
    },
  }
  for (const identity of ["preparing:native-path", prepared.id]) {
    let current = [
      {
        ...prepared,
        id: identity,
        status: "failed",
        retryable: true,
        error: "路径准备暂时失败。",
      },
    ]
    let controller
    function Probe() {
      controller = useComposerMaterials({
        sessionId: sid,
        cwd,
        materials: current,
        anchorRef: useRef(null),
        update: (apply) => {
          current = apply(current)
        },
      })
      return null
    }
    renderToString(
      createElement(
        MaterialServiceContext.Provider,
        { value: service },
        createElement(Probe),
      ),
    )
    assert.equal(controller.canRetry(identity), true)
    await controller.retry(identity)
    assert.equal(current[0].status, "ready")
  }
  assert.equal(calls[0].method, "prepare")
  assert.deepEqual(calls[0].paths, [path])
  assert.equal(calls[1].method, "restore")
  assert.equal(calls[1].references[0].id, prepared.id)
})

test("clicking an expired upload retry explains re-selection without sending a futile request", async () => {
  const service = {
    upload: async () => {
      throw new Error("expired source must not upload")
    },
    prepare: async () => {
      throw new Error("expired source must not reread")
    },
    restore: async () => {
      throw new Error("temporary source has no host record")
    },
  }
  let current = [
    {
      id: "preparing:expired-upload",
      name: "expired.png",
      kind: "附件",
      type: "image",
      status: "failed",
      source: "粘贴或拖入的图片",
      retryable: true,
      error: "准备暂时失败。",
    },
  ]
  let controller
  function Probe() {
    controller = useComposerMaterials({
      sessionId: "expired-session",
      cwd: "H:/workspace/moon",
      materials: current,
      anchorRef: useRef(null),
      update: (apply) => {
        current = apply(current)
      },
    })
    return null
  }
  renderToString(
    createElement(
      MaterialServiceContext.Provider,
      { value: service },
      createElement(Probe),
    ),
  )
  await controller.retry(current[0].id)
  assert.equal(current[0].status, "failed")
  assert.equal(current[0].retryable, false)
  assert.match(current[0].error, /来源已失效，请重新选择/)
})

test("material navigation composed in a message form cannot submit the message", () => {
  const html = renderToString(
    createElement(
      "form",
      null,
      createElement(MaterialRailNavigation, {
        left: true,
        right: true,
        onPage: () => {},
      }),
    ),
  )
  const buttons = html.match(/<button\b[^>]*>/g)
  assert.equal(buttons.length, 2)
  for (const button of buttons) assert.match(button, /type="button"/)
})

test("removing or previewing a selected material inside a message form cannot submit", () => {
  const html = renderToString(
    createElement(
      "form",
      null,
      createElement(SelectedMaterials, {
        materials: [
          {
            id: "authority-file",
            name: "file.md",
            type: "file",
            status: "ready",
            source: "/demo/file.md",
          },
        ],
        onRemove: () => {},
      }),
    ),
  )
  const buttons = html.match(/<button\b[^>]*>/g)
  assert.equal(buttons.length, 2)
  for (const button of buttons) assert.match(button, /type="button"/)
})

function thumbnailBrowser(t, options = {}) {
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image")
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  )
  const images = [],
    canvases = []
  class ThumbnailImage {
    naturalWidth = options.width ?? 800
    naturalHeight = options.height ?? 400
    onload = null
    onerror = null
    source = ""
    constructor() {
      images.push(this)
    }
    set src(value) {
      this.source = value
      if (!value || options.manual) return
      queueMicrotask(() =>
        options.decodeFailed ? this.onerror?.() : this.onload?.(),
      )
    }
    get src() {
      return this.source
    }
    removeAttribute(name) {
      if (name === "src") this.source = ""
    }
  }
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: ThumbnailImage,
  })
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement(name) {
        assert.equal(name, "canvas")
        const canvas = {
          width: 0,
          height: 0,
          getContext(name) {
            assert.equal(name, "2d")
            if (options.contextNull) return null
            return {
              drawImage(image, x, y, width, height) {
                if (options.drawFailed) throw new Error("draw failed")
                assert.equal(image, images.at(-1))
                assert.deepEqual(
                  [x, y, width, height],
                  [0, 0, canvas.width, canvas.height],
                )
              },
            }
          },
          toDataURL(mimeType, quality) {
            assert.deepEqual([mimeType, quality], ["image/webp", 0.75])
            if (options.serializeFailed) throw new Error("serialize failed")
            return options.emptyResult
              ? "data:,"
              : "data:image/webp;base64,YQ=="
          },
        }
        canvases.push(canvas)
        return canvas
      },
    },
  })
  t.after(() => {
    if (originalImage) Object.defineProperty(globalThis, "Image", originalImage)
    else delete globalThis.Image
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument)
    else delete globalThis.document
  })
  return { images, canvases }
}
const thumbnailPreview = {
  id: "image",
  name: "tool.png",
  source: "saved image",
  label: "发送时的图片",
  mimeType: "image/png",
  data: "YQ==",
  content: "",
  truncated: false,
}

test("prepared image thumbnail decodes real dimensions to bounded media and releases byte handlers", async (t) => {
  const { images, canvases } = thumbnailBrowser(t)
  const url = await readMaterialThumbnail(
    thumbnailPreview,
    new AbortController().signal,
  )
  assert.equal(url, "data:image/webp;base64,YQ==")
  assert.deepEqual([canvases[0].width, canvases[0].height], [128, 64])
  assert.equal(images[0].src, "")
  assert.equal(images[0].onload, null)
  assert.equal(images[0].onerror, null)
})

test("missing bytes and unsupported MIME cannot turn an empty canvas or remote source into a thumbnail", async (t) => {
  const { images, canvases } = thumbnailBrowser(t)
  for (const preview of [
    { ...thumbnailPreview, data: "" },
    { ...thumbnailPreview, mimeType: "text/html" },
    { ...thumbnailPreview, mimeType: "image/svg+xml" },
  ])
    await assert.rejects(
      readMaterialThumbnail(preview, new AbortController().signal),
      /没有可解码的图片/,
    )
  assert.equal(images.length, 0)
  assert.equal(canvases.length, 0)
})

test("image decode failure rejects and releases bytes instead of leaving loading forever", async (t) => {
  const { images, canvases } = thumbnailBrowser(t, { decodeFailed: true })
  await assert.rejects(
    readMaterialThumbnail(thumbnailPreview, new AbortController().signal),
    /无法解码/,
  )
  assert.equal(images[0].src, "")
  assert.equal(images[0].onerror, null)
  assert.equal(canvases.length, 0)
})

for (const [name, options] of [
  ["zero dimensions", { width: 0 }],
  ["missing canvas context", { contextNull: true }],
  ["draw failure", { drawFailed: true }],
  ["serialization failure", { serializeFailed: true }],
  ["empty canvas encoding", { emptyResult: true }],
])
  test(`${name} cannot be reported as a ready thumbnail`, async (t) => {
    const { images } = thumbnailBrowser(t, options)
    await assert.rejects(
      readMaterialThumbnail(thumbnailPreview, new AbortController().signal),
    )
    assert.equal(images[0].src, "")
    assert.equal(images[0].onload, null)
  })

test("cancel during image decode releases the old image and ignores its late callback", async (t) => {
  const { images, canvases } = thumbnailBrowser(t, { manual: true })
  const controller = new AbortController()
  const promise = readMaterialThumbnail(thumbnailPreview, controller.signal)
  const lateLoad = images[0].onload
  controller.abort()
  await assert.rejects(promise, { name: "AbortError" })
  lateLoad()
  assert.equal(images[0].src, "")
  assert.equal(images[0].onload, null)
  assert.equal(canvases.length, 0)
})

test("already cancelled thumbnails never create browser decoding resources", async (t) => {
  const { images } = thumbnailBrowser(t)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    readMaterialThumbnail(thumbnailPreview, controller.signal),
    { name: "AbortError" },
  )
  assert.equal(images.length, 0)
})

test("formal thumbnail distinguishes visible loading and failure while keeping preview owned by the card", () => {
  for (const [status, label] of [
    ["loading", "加载中"],
    ["failed", "加载失败"],
  ]) {
    const html = renderToString(
      createElement(MaterialThumbnail, { name: "tool.png", status }),
    )
    assert.match(html, new RegExp(label))
    assert.match(html, /role="status"/)
    assert.doesNotMatch(html, /<img\b|<button\b/)
  }
  const ready = renderToString(
    createElement(MaterialThumbnail, {
      name: "tool.png",
      status: "ready",
      url: "data:image/webp;base64,YQ==",
    }),
  )
  assert.match(ready, /<img\b[^>]*alt="tool.png"/)
  assert.doesNotMatch(ready, /加载失败|加载中/)
})

test("formal preview treats missing image bytes as a designed decode error, not blank text or an endless spinner", () => {
  const html = renderToString(
    createElement(MaterialImagePreview, {
      name: "tool.png",
      mimeType: "image/png",
      data: "",
    }),
  )
  assert.match(html, /无法显示图片/)
  assert.match(html, /重新选择有效图片/)
  assert.doesNotMatch(html, /<img\b|<pre\b|正在加载|<button\b/)
})

test("formal command tool separates the authoritative cwd from output and never fills legacy cwd from the current page", () => {
  const cwd = "H:/工作区/moon/较长目录/真实命令执行目录"
  const tool = {
    id: "shell",
    name: "bash",
    source: "Pi",
    status: "success",
    input: '{"command":"pwd"}',
    result: "actual shell output",
    exitCode: 0,
  }
  function renderCommand(current) {
    return renderToString(
      createElement(
        TooltipProvider,
        null,
        createElement(ToolCall, { tool: current, defaultOpen: true }),
      ),
    )
  }
  const recorded = renderCommand({
    ...tool,
    target: { kind: "command", command: "pwd", cwd },
  })
  assert.match(recorded, /执行目录/)
  assert.match(recorded, new RegExp(cwd))
  assert.ok(recorded.indexOf("执行目录") < recorded.indexOf("命令输出"))
  assert.match(recorded, /actual shell output/)
  const legacy = renderCommand(tool)
  assert.match(legacy, /执行目录<\/dt><dd[^>]*>未记录/)
  assert.doesNotMatch(legacy, new RegExp(cwd))
})
