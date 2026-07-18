/**
 * 工作区双轨协议与 powershell 工具契约文案（单一事实源）。
 *
 * - 逻辑轨：/workspace/<alias>/... → 工具 path / powershell cwd
 * - 展示轨（A1）：alias + displayPath → 仅会话 system 注入
 * - 宿主轨：resolve 结果 → 仅服务端 / 审批 UI / spawn
 */

export const POWERSHELL_TOOL_DESCRIPTION = [
  "在本机已绑定工作区上执行一条 PowerShell 7（pwsh）命令；每条命令需用户批准。",
  "不是 OS 级沙箱，也不是目录挂载。",
  "",
  "参数：",
  "- cwd（必填）：逻辑路径 /workspace/<alias> 或 /workspace/<alias>/子目录。服务端映射为宿主目录作为进程 cwd。",
  "- command（必填）：PowerShell 语法。进程 cwd 已是绑定目录时，优先 `Get-ChildItem` / `ls` 等相对路径命令。",
  "- description（必填）：一句话说明目的，展示在用户审批卡上。",
  "- timeoutMs（可选）：默认 120000，最大 600000。",
  "",
  "协议（必守）：",
  "- 禁止在 command 正文写 /workspace/...（Windows 不会映射该路径）。",
  "- 文件读写/搜索/局部编辑请用 read_file、write_file、edit_file、glob、grep，不要用 powershell 代替。",
  "",
  "有效示例：",
  '- cwd="/workspace/mywork", command="Get-ChildItem"',
  '- cwd="/workspace/mywork", command="Get-ChildItem -Force"',
  '- cwd="/workspace/mywork/src", command="Get-ChildItem -Recurse -Filter *.ts | Select-Object -First 20"',
  "",
  "无效示例：",
  '- command="Get-ChildItem -Path /workspace/mywork"（逻辑路径进 command → 将被拒绝）',
].join("\n");

export const POWERSHELL_APPROVAL_SECURITY_NOTE =
  "这不是操作系统沙箱。批准后命令以当前 Windows 用户权限在解析后的宿主目录中运行，可访问该用户权限下的其它路径。";

/**
 * Claude Code / Keydex 风格局部编辑（精确字符串替换）。
 * 参数命名：filePath 对齐 Eve 读写；old_string / new_string / replace_all 对齐 Claude Code。
 */
export const EDIT_FILE_TOOL_DESCRIPTION = [
  "精确替换已绑定工作区内 UTF-8 文本文件的一段内容（Claude Code 风格局部编辑）。",
  "优先用于修改已有文件；创建新文件用 write_file；不要用 powershell 做文本补丁。",
  "",
  "参数：",
  "- filePath（必填）：逻辑绝对路径 /workspace/<alias>/...。",
  "- old_string（必填、非空）：要替换的原文，须与文件内容逐字一致（含空白与换行）。",
  "- new_string（必填）：替换后的文本。**删除片段时必须传空字符串 \"\"**（JSON 里是 \"new_string\":\"\"），不要省略该字段，也不要把 old_string 留空。",
  "- replace_all（可选，默认 false）：true 时替换全部匹配；false 时若匹配多于一次则失败。",
  "",
  "删除示例：",
  '- 删除一行内片段：old_string="debug: false", new_string=""',
  '- 删除整行（含换行）：old_string="debug: false\\n", new_string=""',
  "",
  "规则：",
  "- 建议先 read_file 再编辑，确保 old_string 唯一且与当前文件一致。",
  "- old_string 与 new_string 相同会被拒绝。",
  "- old_string 为空会被拒绝（创建请用 write_file；删除也必须用非空 old_string + 空 new_string）。",
  "- 成功时 mode 为 replace 或 delete；delete 时 bytesDelta 应为负数。",
  "- 每次调用需用户批准后才会写入。",
].join("\n");

/** 审批预览 API / UI 共用字段。 */
export type WorkspacePathPreview = {
  readonly alias: string;
  readonly logicalPath: string;
  readonly hostPath: string;
  readonly displayRoot: string;
};

export type PowerShellApprovalDisplay = {
  readonly command: string;
  readonly description: string;
  readonly logicalCwd: string;
  readonly hostCwd: string | null;
  readonly alias: string | null;
  readonly displayRoot: string | null;
  readonly outsideBindingHint: boolean;
  readonly securityNote: string;
  readonly previewError: string | null;
};
