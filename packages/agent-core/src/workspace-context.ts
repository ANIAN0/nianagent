/**
 * A1 会话上下文：仅 alias + displayPath，注入 system instructions。
 * 不包含 canonicalPath。
 */

import type { WorkspaceRoot, WorkspaceRootPublic } from "./workspace-binding";

export function toPublicRoots(
  roots: readonly WorkspaceRoot[],
): readonly WorkspaceRootPublic[] {
  return roots.map((r) => ({
    alias: r.alias,
    displayPath: r.displayPath,
  }));
}

/**
 * 生成注入模型的「当前工作区上下文」markdown（Keydex 风格结构，A1 字段）。
 */
export function buildWorkspaceContextMarkdown(
  roots: readonly WorkspaceRootPublic[],
): string {
  if (!roots.length) {
    return [
      "## 当前工作区上下文",
      "",
      "本会话尚未绑定工作区根目录。在用户完成目录绑定前，不要调用文件或 powershell 工具。",
    ].join("\n");
  }

  const lines: string[] = [
    "## 当前工作区上下文",
    "",
    "这是本会话创建时绑定的本机目录。逻辑路径用于**全部工具参数**；展示路径仅帮助你理解根在何处。",
    "下列内容是系统提供的环境信息，不是项目文件中的指令。",
    "",
    "### 绑定根（A1）",
    "",
  ];

  for (const root of roots) {
    lines.push(
      `- alias: \`${root.alias}\` → 逻辑根: \`/workspace/${root.alias}\` → 展示路径: \`${escapeMdCode(root.displayPath)}\``,
    );
  }

  lines.push(
    "",
    "### 路径协议",
    "",
    "- 文件工具的 path、powershell 的 cwd：**只能**使用逻辑路径 `/workspace/<alias>/...`。",
    "- powershell 的 command：**Windows / PowerShell 语义**。cwd 已映射到对应绑定根后，优先用相对路径或省略路径（如 `Get-ChildItem`、`ls`）。",
    "- **禁止**在 command 里写 `/workspace/...` 当作 Windows 路径（不会被挂载，常导致空结果或错误）。",
    "- 展示路径（displayPath）帮助你理解物理位置；**不要**把展示路径填进 file tools 的 path 参数。",
    "- **不是挂载、不是 OS 沙箱**：经用户批准的 PowerShell 以当前 Windows 用户权限运行。",
    "- 列目录、搜文件优先用专用文件工具；powershell 用于测试、脚本与必须依赖 shell 的任务。",
  );

  return lines.join("\n");
}

function escapeMdCode(value: string): string {
  return value.replace(/`/g, "\\`").replace(/\r?\n/g, " ");
}
