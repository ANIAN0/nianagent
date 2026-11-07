import { useMemo, useState } from "react"
import type { CatalogEntry } from "../../catalog-types.ts"
import type {
  ConversationChatTool,
  ConversationChatMessage,
  PluginDescriptor,
} from "@/contracts/rpc.generated"
import { Button } from "@/components/ui/button"
import {
  PluginSessionWorkspace,
  type PluginSessionRegistry,
} from "@/features/plugins/plugin-workspace"
import manifest from "../../../../../file-workbench/manifest.json"
import filePlugin, {
  FileDirectory,
  FileChanges,
  FilePanel,
} from "../../../../../file-workbench/web"
import { ConversationPageExample } from "../../../fixtures/conversation-page-stories.tsx"
import { createConversationPageEnvironment } from "../../../fixtures/conversation-page-service.ts"
import type { PluginContext } from "@/features/plugins/plugin-api"
import type { FileWorkbenchService } from "../../../../../file-workbench/file-service"

const root = "/catalog"
const originalPatch =
  "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-# Before\n+# Moon\n"
const tool: ConversationChatTool = {
  id: "catalog-write",
  occurrenceId: "catalog-entry:0",
  name: "edit",
  source: "Pi",
  status: "success",
  input: '{"path":"README.md"}',
  result: "目录中的隔离操作结果",
  resultAvailability: "available",
  artifact: {
    path: `${root}/README.md`,
    displayPath: "README.md",
    operation: "edit",
  },
  details: { patch: originalPatch },
}
function pdfBytes() {
  const content =
    "BT /F1 24 Tf 60 720 Td (Moon file workbench Preview) Tj 0 -40 Td (Select this text in the formal PDF viewer.) Tj ET"
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let text = "%PDF-1.4\n"
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(text.length)
    text += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const start = text.length
  text += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
  return new TextEncoder().encode(text)
}
type PreviewService = FileWorkbenchService & {
  save: () => void
  recover: () => void
}
export function createPreviewService(
  failure: boolean,
  noGit: boolean
): PreviewService {
  let revision = 1
  const encoder = new TextEncoder()
  const contents = new Map<
    string,
    { kind: string; mimeType: string; bytes: Uint8Array }
  >([
    [
      "README.md",
      {
        kind: "markdown",
        mimeType: "text/markdown",
        bytes: encoder.encode(
          "# Moon\n\n这是完整正式工作栏的隔离内容。\n\n选择文字后引用，或切换源码查看实际选区。\n\n" +
            Array.from(
              { length: 60 },
              (_, index) => `第 ${index + 1} 段阅读内容。\n\n`
            ).join("")
        ),
      },
    ],
    [
      "source.ts",
      {
        kind: "text",
        mimeType: "text/plain",
        bytes: encoder.encode(
          'export const moon = true\r\nexport const version = "0.2.0"\rexport const ready = true\n'
        ),
      },
    ],
    [
      "image.svg",
      {
        kind: "image",
        mimeType: "image/svg+xml",
        bytes: encoder.encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#dbeafe"/><circle cx="800" cy="600" r="300" fill="#3b82f6"/><text x="600" y="620" font-size="72" fill="white">Moon</text></svg>'
        ),
      },
    ],
    [
      "sample.pdf",
      { kind: "pdf", mimeType: "application/pdf", bytes: pdfBytes() },
    ],
    [
      "archive.zip",
      {
        kind: "unsupported",
        mimeType: "application/octet-stream",
        bytes: new Uint8Array([0, 1, 2, 3]),
      },
    ],
  ])
  return {
    save: () => {
      revision++
    },
    recover: () => {
      failure = false
    },
    tools: async (_sessionId, signal) => {
      signal.throwIfAborted()
      return [tool]
    },
    call: async <T,>(
      operation: string,
      input: object,
      _sessionId: string,
      signal?: AbortSignal
    ): Promise<T> => {
      signal?.throwIfAborted()
      const request = input as Record<string, unknown>
      const name =
        String(request.path || "")
          .split("/")
          .at(-1) || ""
      const entry = contents.get(name)
      const version = String(revision)
      let result: unknown
      if (operation === "view") result = { requests: [] }
      else if (operation === "tree")
        result = {
          cwd: root,
          path: root,
          truncated: false,
          entries: [...contents.keys()].map((name) => ({
            path: `${root}/${name}`,
            name,
            directory: false,
            linked: false,
          })),
        }
      else if (operation === "git")
        result = noGit
          ? { available: false, error: "隔离目录未初始化Git仓库。" }
          : {
              available: true,
              root,
              entries: [
                {
                  name: "README.md",
                  path: "README.md",
                  stage: "unstaged",
                  status: " M",
                },
              ],
            }
      else if (operation === "gitDiff")
        result = {
          patch:
            revision === 1
              ? originalPatch
              : originalPatch.replace(
                  "+# Moon",
                  `+# Moon revision ${revision}`
                ),
        }
      else {
        if (failure)
          throw new Error("示例来源暂时不可读；恢复读取后重新打开或刷新。")
        if (!entry) throw new Error("隔离内容中没有此路径。")
        if (operation === "info")
          result = {
            path: `${root}/${name}`,
            requested: `${root}/${name}`,
            name,
            bytes: entry.bytes.length,
            version,
            kind: entry.kind,
            mimeType: entry.mimeType,
          }
        else if (operation === "state")
          result = { path: `${root}/${name}`, version }
        else if (operation === "text")
          result = {
            content: new TextDecoder().decode(entry.bytes),
            offset: 0,
            next: entry.bytes.length,
            line: 1,
            nextLine: 4,
            complete: true,
          }
        else if (operation === "bytes")
          result = {
            data: btoa(String.fromCharCode(...entry.bytes)),
            offset: 0,
            next: entry.bytes.length,
            complete: true,
            version,
          }
        else if (operation === "reference" || operation === "selection")
          result = {
            material: {
              id:
                operation === "selection"
                  ? crypto.randomUUID()
                  : (crypto.randomUUID() + crypto.randomUUID()).replaceAll(
                      "-",
                      ""
                    ),
              name,
              source: `${root}/${name}`,
              description:
                operation === "selection"
                  ? String(request.text)
                  : "隔离当前路径引用",
              kind: "附件",
              type: operation === "selection" ? "selection" : "file",
              status: "ready",
              ...(operation === "selection"
                ? Object.fromEntries(
                    Object.entries(request).filter(
                      ([key]) => key !== "path" && key !== "text"
                    )
                  )
                : {}),
            },
          }
        else throw new Error(`隔离服务不提供 ${operation}`)
      }
      return result as T
    },
  }
}
export function WorkbenchExample({
  failure = false,
  noGit = false,
  interaction = false,
  compact = false,
  moduleRecovery = false,
  initialModuleFailure = false,
  deliveryRecovery = false,
}: {
  failure?: boolean
  noGit?: boolean
  interaction?: boolean
  compact?: boolean
  moduleRecovery?: boolean
  initialModuleFailure?: boolean
  deliveryRecovery?: boolean
}) {
  const [service] = useState(() => createPreviewService(failure, noGit))
  const [enabled, setEnabled] = useState(true)
  const [moduleFailed, setModuleFailed] = useState(initialModuleFailure)
  const [generation, setGeneration] = useState(1)
  const [notice, setNotice] = useState("")
  const [environment] = useState(() => {
    const userId = "catalog-files-user"
    const runId = "catalog-files-run"
    const names = [
      "README.md",
      "source.ts",
      "image.svg",
      "sample.pdf",
      "archive.zip",
    ]
    const messages: ConversationChatMessage[] = [
      {
        id: userId,
        userTurnId: userId,
        runId,
        historyIndex: 0,
        role: "user",
        text: "帮我整理项目说明，并把文件交付给我。",
        time: "2026-10-17T10:00:00Z",
        status: "settled",
      },
      {
        id: `${runId}-answer`,
        entryId: `${runId}-answer`,
        userTurnId: userId,
        runId,
        historyIndex: 1,
        role: "assistant",
        status: "settled",
        stopReason: "stop",
        time: "2026-10-17T10:01:00Z",
        text: "项目说明与相关材料已整理。可以打开交付文件查看，或引用选区继续讨论。",
        tools: names.map((name, index) => ({
          ...tool,
          id: `catalog-delivery-${index}`,
          occurrenceId: `catalog-delivery-${index}`,
          presentation: {
            pluginId: manifest.id,
            kind: "file-link",
            version: 1,
            payload: JSON.stringify({ path: `${root}/${name}`, name }),
            summary: name,
          },
        })),
      },
    ]
    return createConversationPageEnvironment("page-ready", {
      cwd: root,
      title: "整理项目说明",
      messages,
      snapshot: {
        runId,
        statistics: undefined,
        phase: interaction ? "running" : "completed",
        approvals: interaction
          ? [
              {
                id: "catalog-files-input",
                runId,
                kind: "input",
                pluginId: manifest.id,
                title: "填写交付说明",
                message: "这段说明将随文件一同交付。",
                expiresAt: new Date(Date.now() + 600000).toISOString(),
              },
            ]
          : [],
      },
    })
  })
  const module = useMemo(
    () => ({
      ...filePlugin,
      deliveries: filePlugin.deliveries?.map((definition) => ({
        ...definition,
        component:
          deliveryRecovery && generation === 1
            ? () => {
                throw new Error("示例交付组件渲染失败。")
              }
            : definition.component,
      })),
      // Use every formal tab's metadata and body with this isolated file port.
      tabs: filePlugin.tabs!.map((definition) => ({
        ...definition,
        component: (context: PluginContext) => {
          const Content =
            definition.id === "files"
              ? FileDirectory
              : definition.id === "changes"
                ? FileChanges
                : FilePanel
          return <Content {...context} service={service} />
        },
      })),
      connectSession: undefined,
    }),
    [service, deliveryRecovery, generation]
  )
  const registry = useMemo<PluginSessionRegistry>(
    () => ({
      entries: [
        {
          descriptor: {
            id: manifest.id,
            name: manifest.name,
            description: manifest.description,
            version: manifest.version,
            source: "catalog/file-workbench",
            sourceKind: "bundled",
            installed: true,
            enabled,
            revision: 0,
            generation,
            state: enabled ? "active" : "disabled",
            businessState: "",
            error: "",
            configuration: JSON.stringify(manifest.defaultConfiguration),
            configurationSchema: JSON.stringify(manifest.configurationSchema),
            contributions:
              manifest.contributions as PluginDescriptor["contributions"],
            tools: [],
            effects: manifest.effects,
          },
          module: enabled && !moduleFailed ? module : undefined,
          ...(moduleFailed ? { error: "插件资源暂时无法读取。" } : {}),
        },
      ],
      error: "",
    }),
    [enabled, module, moduleFailed, generation]
  )
  return (
    <div
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground"
      style={compact ? { width: "min(100%, 520px)" } : undefined}
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        <ConversationPageExample
          scenario="page-ready"
          environment={environment}
          showControls={false}
          frame={({ children, ...session }) => (
            <PluginSessionWorkspace
              key={session.sessionId}
              {...session}
              active
              registry={registry}
              reload={async () => {
                setModuleFailed(false)
              }}
              reply={(request) => {
                const result = environment.permission.reply(
                  request.sessionId,
                  request.approvalId,
                  request.runId,
                  request.value
                )
                environment.acknowledgeApproval(request.sessionId)
                return result
              }}
            >
              {children}
            </PluginSessionWorkspace>
          )}
        />
      </div>
      <details className="shrink-0 border-t px-4 py-2 text-xs">
        <summary>示例控制</summary>
        <div className="flex flex-wrap gap-2 py-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              service.save()
              setNotice("隔离来源已保存。")
            }}
          >
            模拟外部保存
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEnabled((value) => !value)}
          >
            {enabled ? "停用文件插件" : "启用文件插件"}
          </Button>
          {moduleRecovery && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setModuleFailed(true)}
            >
              模拟插件资源加载失败
            </Button>
          )}
          {deliveryRecovery && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setGeneration((value) => value + 1)}
            >
              更新插件代次并恢复交付
            </Button>
          )}
          {failure && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                service.recover()
                setNotice("隔离读取已恢复。")
              }}
            >
              恢复读取
            </Button>
          )}
        </div>
        <p role="status">{notice}</p>
      </details>
    </div>
  )
}
export default {
  id: "file-workbench",
  name: "完整文件工作栏",
  source: "backend/plugins/file-workbench/web.tsx",
  group: "文件工作栏",
  layer: "组合验证",
  order: 181,
  pages: ["会话"],
  stage: "content",
  description:
    "复用正式FilePanel、文件卡片、树、标签、源码/Markdown/图像/PDF、选区、会话操作和Git差异完整组合。",
  boundary:
    "展示服务及草稿仅存在本预览；不调用真实RPC、不读用户文件、不改变真实模型/权限。原生编辑器/另存及真实模型采用另在正式入口验收。",
  inputs: [
    "PluginContext / payload / service",
    "可注入FileWorkbenchService；默认仍是正式插件RPC及会话读取",
  ],
  events: [
    "真实路径打开/引用/下载",
    "实际选区引用",
    "宿主拖动栏宽、展开/收起、关闭标签",
    "可见Git自动读取与来源切换",
  ],
  composition: [
    "FilePanel / Tree / FileBody / SourceViewer / ImageBody / PdfViewer",
    "PluginSessionWorkspace / LiveConversationView / ConversationComposer / FileDelivery / PluginContext",
    "FileDirectory / ChangesViewer / GitViewer / ReadOnlyPatch / ResizablePanelGroup",
  ],
  consumers: ["PluginSessionHost → 会话右侧标签", "轮次交付卡片"],
  standards: [
    {
      id: "FW2",
      name: "可见页面订阅",
      rule: "页面隐藏即释放自动预览目标，恢复可见时使用新的订阅身份和代次；迟到结果不能打开旧目标。",
      reason: "已失效的目标不能续用，也不能接收隐藏期间的旧打开请求。",
      check:
        "在正式会话隐藏并恢复页面后调用 open_file，确认当前页面打开预览且旧请求不重放。",
    },
    {
      id: "FW1",
      name: "完整连续阅读",
      rule: "同一消费者中切换真实入口、标签和变更；准确选区且不改写文件。",
      reason: "孤立预置图不能代表文件工作栏行为。",
      check:
        "从卡片打开PDF/图像，缩放滚动后切标签/折叠再回到原位置；源码选区准确。",
    },
  ],
  states: [
    {
      id: "reading",
      name: "路径与实际选区",
      section: "normal",
      condition: "隔离会话含源码与Markdown文件。",
      steps: [
        "打开source.ts并选择第二至第三行，引用。",
        "打开README.md，切源码与渲染，引用实际文字。",
        "关闭一个标签再收起/重开文件栏。",
      ],
      expected: "正式选区与文件卡片协作，草稿材料独立累计，内容保持只读。",
      render: () => <WorkbenchExample />,
    },
    {
      id: "media",
      name: "图像与PDF连续阅读",
      section: "normal",
      condition: "合法SVG图像及内存PDF由隔离服务提供。",
      steps: [
        "从卡片打开image.svg和sample.pdf。",
        "缩放并滚动，切标签、折叠/重开、展开/还原。",
        "选择PDF实际文字并引用一次。",
      ],
      expected: "完整正式媒体组件保留消费者位置，PDF只有一个实际选区引用入口。",
      render: () => <WorkbenchExample />,
    },
    {
      id: "changes",
      name: "会话操作与Git",
      section: "normal",
      condition: "原隔离成功工具patch和当前Git差异不同。",
      steps: [
        "从右栏入口页打开变更，分别选择两种来源。",
        "选README.md Git差异，再模拟外部保存。",
        "打开当前文件。",
      ],
      expected: "原操作patch固定；可见Git读取更新，手动打开读取当前路径。",
      render: () => <WorkbenchExample />,
    },
    {
      id: "read-failure",
      name: "读取失败与恢复",
      section: "exception",
      condition: "隔离来源不可读。",
      steps: ["打开文件观察原位失败。", "恢复读取后重新打开。"],
      expected: "不补造成功内容；恢复后实际重新读取隔离服务。",
      render: () => <WorkbenchExample failure />,
    },
    {
      id: "no-git",
      name: "未初始化Git",
      section: "states",
      condition: "隔离工作目录不是Git仓库。",
      steps: ["进入变更的Git来源。", "切回会话操作查看原patch。"],
      expected: "Git不可用状态可见，原会话操作仍独立可读。",
      render: () => <WorkbenchExample noGit />,
    },
  ],
  viewport: { width: 1180, height: 760 },
} satisfies CatalogEntry
