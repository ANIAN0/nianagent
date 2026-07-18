/**
 * PowerShell command 协议护栏：禁止把逻辑路径当 Windows 路径写进 command 正文。
 * 不拦截盘符/UNC（交审批卡高亮）；不做伪安全黑名单。
 */

import { WORKSPACE_LOGICAL_PREFIX } from "./workspace-paths";

export type CommandGuardIssue =
  | {
      readonly code: "logical_path_in_command";
      readonly message: string;
    }
  | {
      readonly code: "empty_command";
      readonly message: string;
    };

/** command 中出现逻辑工作区路径痕迹（POSIX 或反斜杠写法）。 */
const LOGICAL_PATH_IN_COMMAND =
  /(?:^|[\s"'`(=,[\]{])\/workspace(?:\/|$)|(?:^|[\s"'`(=,[\]{])\\workspace(?:\\|$)/i;

/** 盘符或 UNC，仅用于审批提示，不拒绝执行。 */
const HOST_ABSOLUTE_HINT =
  /(?:^|[\s"'`(=,[\]{])(?:[A-Za-z]:[\\/]|\\\\|\/\/)/;

export function assertPowerShellCommandProtocol(command: string): void {
  const issue = inspectPowerShellCommand(command);
  if (issue) {
    throw new Error(issue.message);
  }
}

export function inspectPowerShellCommand(
  command: string,
): CommandGuardIssue | null {
  if (!command.trim()) {
    return {
      code: "empty_command",
      message: "PowerShell 命令不能为空。",
    };
  }
  if (LOGICAL_PATH_IN_COMMAND.test(command)) {
    return {
      code: "logical_path_in_command",
      message:
        `命令正文禁止包含逻辑路径 ${WORKSPACE_LOGICAL_PREFIX}<alias>/...（Windows 不会映射该路径）。` +
        `请将 cwd 设为 /workspace/<alias>[/子目录]，command 内使用相对路径（如 Get-ChildItem）或展示路径下的相对段。`,
    };
  }
  return null;
}

/** 审批 UI：命令可能指向绑定根以外的宿主绝对路径。 */
export function commandMayAccessOutsideBinding(command: string): boolean {
  return HOST_ABSOLUTE_HINT.test(command);
}
