import { useState } from "react"
import type {
  ConversationChatMessage,
  ConversationSnapshot,
  MaterialPreview,
} from "@/features/models/model-contract.generated"
import type { HomeDraft } from "@/features/home/home-types"
import {
  MaterialServiceContext,
  type MaterialService,
} from "@/features/materials/material-service"
import {
  exampleMaterials,
  exampleMaterialService,
} from "@/features/materials/material-catalog-fixtures"
import { homeData } from "../../../../ui-catalog/fixtures/home"
import { createCatalogConversationControls } from "../../../../ui-catalog/fixtures/conversation-controls"
import { LiveConversationView } from "../live-conversation-view"
import { capturedConversationPaths } from "./conversation-path-catalog-data"

export type ConversationPathScenario =
  | "ten-tools"
  | "ordered-streaming"
  | "tool-running"
  | "tool-failure"
  | "stopped"
  | "recovered"
  | "length"
  | "media"
  | "long-code"
  | "pending-submission"
  | "short-window"
const cwd = "H:/workspace/moon"
const generatedMaterial = {
  id: "catalog-generated",
  name: "generated.md",
  kind: "附件" as const,
  type: "file" as const,
  status: "ready" as const,
  source: cwd + "/generated.md",
}
const inputMaterial = {
  ...generatedMaterial,
  id: "catalog-input",
  name: "input.md",
  source: cwd + "/input.md",
}
const service: MaterialService = {
  ...exampleMaterialService,
  prepare: async (...args) => {
    const paths = args[2]
    const found = [generatedMaterial, inputMaterial].filter(
      (item) => paths.includes(item.source) || paths.includes(item.name)
    )
    if (!found.length)
      throw Object.assign(new Error("此演示文件不在工作区内。"), {
        issue: {
          code: "material_unavailable",
          summary: "此文件不在演示工作区内。",
          severity: "warning",
          recovery: "none",
        },
      })
    return found
  },
  preview: async (...args): Promise<MaterialPreview> => {
    const id = args[1]
    const item = [generatedMaterial, inputMaterial].find(
      (item) => item.id === id
    )
    if (!item) return exampleMaterialService.preview(...args)
    return {
      id,
      name: item.name,
      source: item.source,
      label: "当前文件",
      content:
        id === "catalog-generated"
          ? "# Text ten\nMOON-TEXT-10-GENERATED"
          : "# Moon acceptance\n状态：已更新\nMOON-text-10-INPUT",
      mimeType: "",
      data: "",
      truncated: false,
    }
  },
}
function stagedMessages(): ConversationChatMessage[] {
  return capturedConversationPaths.tenTools.map((message, index) => ({
    ...message,
    id: "catalog-stage-" + index,
    entryId: undefined,
    userTurnId: "catalog-stage-0",
    historyIndex: index * 2,
    forkable: false,
    runId: "catalog-staged-run",
    blocks: message.blocks?.map((block) => ({
      ...block,
      id: "catalog-stage-" + index + ":" + block.id,
    })),
    ...(index === 0
      ? {
          text: "依次读取 8 个文件，修改输入并生成说明；这是顺序与状态的合约演示。",
        }
      : {}),
  }))
}
export function conversationPathMessages(
  scenario: ConversationPathScenario
): ConversationChatMessage[] {
  if (scenario === "stopped" || scenario === "recovered") {
    const messages: ConversationChatMessage[] = [
      ...capturedConversationPaths.stopped,
    ]
    if (scenario === "recovered")
      messages.push(
        {
          id: "catalog-continuation",
          userTurnId: "catalog-continuation",
          continuationOf: messages[0]!.userTurnId,
          inputKind: "continuation",
          role: "user",
          status: "settled",
          historyIndex: 18,
          text: "继续上次回复。",
          time: "2026-10-04T02:30:00.000Z",
          runId: "catalog-resumed-run",
        },
        {
          id: "catalog-resumed-answer",
          userTurnId: "catalog-continuation",
          role: "assistant",
          status: "settled",
          historyIndex: 19,
          text: "后续回复已完成；原执行的停止状态保持独立。",
          time: "2026-10-04T02:30:06.000Z",
          model: "DeepSeek-V4-Flash",
          stopReason: "stop",
          runId: "catalog-resumed-run",
        }
      )
    return messages
  }
  if (scenario === "tool-failure") return capturedConversationPaths.toolFailure
  if (scenario === "ten-tools") return capturedConversationPaths.tenTools
  const messages = stagedMessages()
  const firstStep = messages[1]!
  firstStep.blocks = [
    {
      id: "catalog-thinking",
      type: "thinking",
      text: "先确认读取顺序与目标。\n\n随后检查实际文件变更。",
      phase: "settled",
    },
    {
      id: "catalog-before-tools",
      type: "text",
      text: "准备读取输入，然后依次检查资料文件。",
      phase: "settled",
    },
    ...(firstStep.blocks ?? []),
  ]
  const tail = messages.at(-1)!
  if (scenario === "ordered-streaming") {
    tail.status = "streaming"
    tail.stopReason = undefined
    tail.text = "已完成 10 次工具调用，正在整理最终回复…"
    tail.blocks = [
      {
        id: "catalog-final-text",
        type: "text",
        text: tail.text,
        phase: "running",
      },
    ]
    tail.activeBlockId = "catalog-final-text"
  } else if (scenario === "tool-running") {
    messages.pop()
    const step = messages.at(-1)!
    step.status = "streaming"
    step.stopReason = undefined
    step.blocks = step.blocks?.map((block) =>
      block.type === "tool"
        ? {
            ...block,
            tool: {
              ...block.tool,
              status: "running",
              result: "",
              artifact: undefined,
            },
          }
        : block
    )
  } else if (scenario === "length") {
    tail.stopReason = "length"
    tail.text = "已经完成前半部分，后续内容"
    tail.blocks = [
      { id: "catalog-length", type: "text", text: tail.text, phase: "settled" },
    ]
  } else if (scenario === "media") {
    messages[0]!.attachments = [
      { ...exampleMaterials[0]!, kind: "file", materialType: "file" },
      { ...exampleMaterials[1]!, kind: "file", materialType: "skill" },
    ]
    tail.blocks = [
      ...(tail.blocks ?? []),
      {
        id: "catalog-output-image",
        type: "image",
        image: exampleMaterials[2]!,
      },
    ]
  } else if (scenario === "long-code") {
    const code = Array.from(
      { length: 180 },
      (_, index) => "const value" + index + " = " + index + ";"
    ).join("\n")
    const fence = String.fromCharCode(96).repeat(3)
    tail.text =
      "## 长代码与文件引用\n\n" +
      fence +
      "ts\n" +
      code +
      "\n" +
      fence +
      "\n\n[生成说明](generated.md#L2) · [外部文档](https://example.com)\n\n![未验证远程资源](https://example.com/tracking.png)"
    tail.blocks = [
      {
        id: "catalog-long-code",
        type: "text",
        text: tail.text,
        phase: "settled",
      },
    ]
  }
  return messages
}
export function ConversationPathExample({
  scenario,
}: {
  scenario: ConversationPathScenario
}) {
  const [active, setActive] = useState(scenario)
  const [draft, setDraft] = useState<HomeDraft>({
    sessionId: "catalog-path-" + scenario,
    workspaceId: "moon",
    model: homeData.models[0]!,
    thinking: "中等",
    text: scenario === "short-window" ? "长稿检查行\n".repeat(30) : "",
    materials:
      scenario === "short-window"
        ? [exampleMaterials[0]!, exampleMaterials[1]!]
        : [],
    session: {
      toolIds: ["read", "write", "edit", "bash"],
      instructionScope: "all",
    },
  })
  const [controls] = useState(() => createCatalogConversationControls())
  const running =
    active === "ordered-streaming" ||
    active === "tool-running" ||
    active === "short-window"
  const messages = conversationPathMessages(active)
  const snapshot: ConversationSnapshot = {
    id: "catalog-path-" + scenario,
    workspaceId: "moon",
    cwd,
    title: "工具执行与消息轮次",
    inputAccepted: true,
    clientRequestId: "catalog-path-request",
    epoch: "catalog-isolated-host",
    version: 1,
    runId: messages.at(-1)?.runId ?? "catalog-path-run",
    modelId: draft.model,
    connectionId: "catalog",
    providerModelId: "DeepSeek-V4-Flash",
    thinking: "medium",
    phase: running
      ? "running"
      : active === "stopped"
        ? "interrupted"
        : "completed",
    error: "",
    messages,
    canContinue: active === "length" || active === "stopped",
    runtime: running
      ? {
          phase: active === "tool-running" ? "tool" : "responding",
          toolName: active === "tool-running" ? "write" : undefined,
          updatedAt: "2026-10-04T02:31:00.000Z",
        }
      : undefined,
    queue:
      active === "short-window"
        ? {
            revision: 1,
            mode: "single",
            paused: false,
            acceptedRequestIds: ["catalog-q"],
            items: [
              {
                id: "catalog-q",
                clientRequestId: "catalog-q",
                text: "排队消息 ".repeat(80),
                materials: [exampleMaterials[0]!],
                delivery: "followUp",
                status: "pending",
                error: "",
                createdAt: "2026-10-04T02:31:00.000Z",
              },
            ],
          }
        : undefined,
  }
  return (
    <MaterialServiceContext.Provider value={service}>
      <div
        style={{
          height: scenario === "short-window" ? 560 : "100dvh",
          minHeight: 0,
        }}
        className="flex flex-col"
      >
        <p className="shrink-0 px-4 py-1 text-xs text-muted-foreground">
          隔离组件演示：10
          工具、失败工具及停止数据摘自实际验收；顺序、长度上限、恢复及媒体状态为合约演示，不访问磁盘或模型。
        </p>
        <div className="min-h-0 flex-1">
          <LiveConversationView
            id={snapshot.id}
            title={snapshot.title}
            workspacePath={cwd}
            snapshot={snapshot}
            data={{ ...homeData, materials: exampleMaterials }}
            draft={draft}
            controlService={controls}
            onChange={setDraft}
            onSend={() => setActive("ordered-streaming")}
            onStop={() => setActive("stopped")}
            onContinue={() => setActive("ordered-streaming")}
            onReload={() => {}}
            onQueueEdit={async () => {}}
            onQueueRemove={() => {}}
            onQueueDeliver={() => {}}
            pending={scenario === "pending-submission"}
            unconfirmed={scenario === "pending-submission"}
            pendingSubmission={
              scenario === "pending-submission"
                ? {
                    id: "catalog-unconfirmed",
                    kind: "send",
                    draft: {
                      ...draft,
                      text: "这条消息仍等待接收确认。",
                      materials: [exampleMaterials[0]!],
                    },
                  }
                : undefined
            }
          />
        </div>
      </div>
    </MaterialServiceContext.Provider>
  )
}
