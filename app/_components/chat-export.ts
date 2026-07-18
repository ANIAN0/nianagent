/**
 * 当前会话导出（DEF-011）：从内存中的 messages + session 元数据生成 json/md 下载。
 * 不依赖服务端归档；与 sessionStorage 快照互补。
 */

import type { EveMessage, EveMessagePart } from "eve/react";
import type { ChatAgentId, StoredBinding } from "./chat-session-storage";

export type ChatExportMeta = {
  readonly agentId: ChatAgentId;
  readonly exportedAt: string;
  readonly binding: StoredBinding;
  readonly session: unknown;
  readonly eventCount: number;
  readonly messageCount: number;
};

export type ChatExportDocument = {
  readonly meta: ChatExportMeta;
  readonly messages: readonly unknown[];
};

function partToPlain(part: EveMessagePart): Record<string, unknown> {
  // 结构化保留，供 JSON 与 md 摘要
  return { ...part } as Record<string, unknown>;
}

function messageToPlain(message: EveMessage): Record<string, unknown> {
  return {
    id: message.id,
    role: message.role,
    metadata: message.metadata ?? null,
    parts: message.parts.map(partToPlain),
  };
}

export function buildChatExportDocument(input: {
  readonly agentId: ChatAgentId;
  readonly binding: StoredBinding;
  readonly session: unknown;
  readonly events: readonly unknown[];
  readonly messages: readonly EveMessage[];
}): ChatExportDocument {
  return {
    meta: {
      agentId: input.agentId,
      exportedAt: new Date().toISOString(),
      binding: input.binding,
      session: input.session ?? null,
      eventCount: input.events.length,
      messageCount: input.messages.length,
    },
    messages: input.messages.map(messageToPlain),
  };
}

function escapeMd(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function summarizePart(part: EveMessagePart): string {
  switch (part.type) {
    case "text":
      return escapeMd(part.text);
    case "reasoning":
      return `> （推理）\n>\n> ${escapeMd(part.text).split("\n").join("\n> ")}`;
    case "dynamic-tool": {
      const lines = [
        `**工具** \`${part.toolName}\` · 状态 \`${part.state}\``,
        "",
        "```json",
        JSON.stringify(
          {
            toolCallId: part.toolCallId,
            input: "input" in part ? part.input : undefined,
            output: "output" in part ? part.output : undefined,
            errorText: "errorText" in part ? part.errorText : undefined,
            approval: "approval" in part ? part.approval : undefined,
          },
          null,
          2,
        ),
        "```",
      ];
      return lines.join("\n");
    }
    case "file":
      return `附件：${part.filename ?? "(unnamed)"} (${part.mediaType})`;
    case "authorization":
      return `授权：${part.displayName} · ${part.state}`;
    case "step-start":
      return "";
    default:
      return `\`\`\`json\n${JSON.stringify(part, null, 2)}\n\`\`\``;
  }
}

export function buildChatExportMarkdown(doc: ChatExportDocument): string {
  const { meta } = doc;
  const roots = meta.binding.roots
    .map((r) => `- \`${r.alias}\` → ${r.displayPath}`)
    .join("\n");

  const sections: string[] = [
    `# 聊天导出会话`,
    "",
    `- Agent: \`${meta.agentId}\``,
    `- 导出时间: ${meta.exportedAt}`,
    `- workspaceId: \`${meta.binding.workspaceId}\``,
    `- 消息数: ${meta.messageCount}`,
    `- 事件数: ${meta.eventCount}`,
    "",
    `## 绑定根`,
    "",
    roots || "（无）",
    "",
    `## 消息`,
    "",
  ];

  for (const raw of doc.messages) {
    const m = raw as {
      id?: string;
      role?: string;
      parts?: EveMessagePart[];
    };
    sections.push(`### ${m.role ?? "unknown"} · \`${m.id ?? "?"}\``);
    sections.push("");
    const parts = Array.isArray(m.parts) ? m.parts : [];
    for (const part of parts) {
      const body = summarizePart(part as EveMessagePart);
      if (body) {
        sections.push(body);
        sections.push("");
      }
    }
  }

  sections.push(`## 原始 session cursor（JSON）`);
  sections.push("");
  sections.push("```json");
  sections.push(JSON.stringify(meta.session, null, 2));
  sections.push("```");
  sections.push("");

  return sections.join("\n");
}

export function downloadTextFile(input: {
  readonly filename: string;
  readonly content: string;
  readonly mime: string;
}): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([input.content], { type: input.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = input.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportChatAsJson(doc: ChatExportDocument, agentId: ChatAgentId): void {
  const stamp = doc.meta.exportedAt.replace(/[:.]/g, "-");
  downloadTextFile({
    filename: `nianagent-chat-${agentId}-${stamp}.json`,
    content: `${JSON.stringify(doc, null, 2)}\n`,
    mime: "application/json;charset=utf-8",
  });
}

export function exportChatAsMarkdown(
  doc: ChatExportDocument,
  agentId: ChatAgentId,
): void {
  const stamp = doc.meta.exportedAt.replace(/[:.]/g, "-");
  downloadTextFile({
    filename: `nianagent-chat-${agentId}-${stamp}.md`,
    content: buildChatExportMarkdown(doc),
    mime: "text/markdown;charset=utf-8",
  });
}
