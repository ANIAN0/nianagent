/**
 * 宿主原生 edit_file：Claude Code / Keydex 风格精确字符串替换。
 *
 * 参考：
 * - Keydex `backend/app/tools/edit_ops.py`（old_string / new_string / replace_all）
 * - Pi `packages/coding-agent/src/core/tools/edit.ts`（BOM 剥离、精确匹配）
 *
 * 不经 sandbox.run；路径 containment 由调用方或本模块 resolve 完成。
 *
 * 删除约定：`new_string === ""` 表示删除 `old_string` 匹配片段（可含换行）。
 * 部分模型/链路会把空串省略成 null/undefined，执行前会规范化为 ""。
 */

import { readFile, writeFile } from "node:fs/promises";
import type { WorkspaceRoot } from "./workspace-binding";
import {
  resolveWorkspacePath,
  WorkspacePathError,
} from "./workspace-paths";

export type HostEditFileInput = {
  /** 逻辑绝对路径 /workspace/<alias>/... */
  readonly filePath: string;
  /** 要替换的原文；非空时须与文件内容精确匹配 */
  readonly old_string: string;
  /**
   * 替换后文本。
   * 空串表示删除该片段；运行时也接受 null/undefined（规范化为空串）。
   */
  readonly new_string: string | null | undefined;
  /** true 时替换全部匹配；默认 false，多匹配则拒绝 */
  readonly replace_all?: boolean;
};

export type HostEditFileResult = {
  readonly filePath: string;
  readonly hostPath: string;
  /** new_string 为空时为 delete，否则 replace */
  readonly mode: "replace" | "delete";
  readonly changed: true;
  readonly matchCount: number;
  readonly replaceAll: boolean;
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  /** bytesAfter - bytesBefore；删除时通常为负 */
  readonly bytesDelta: number;
};

function stripBom(raw: string): { bom: string; text: string } {
  if (raw.charCodeAt(0) === 0xfeff) {
    return { bom: "\uFEFF", text: raw.slice(1) };
  }
  return { bom: "", text: raw };
}

/**
 * 规范化编辑字符串入参。
 * - new_string：null/undefined → ""（删除语义）
 * - old_string：必须为非空字符串
 */
export function normalizeEditStrings(input: {
  readonly old_string: unknown;
  readonly new_string: unknown;
}): { oldString: string; newString: string } {
  if (typeof input.old_string !== "string") {
    throw new Error(
      "old_string 必须是字符串。删除片段时：old_string 填要删除的原文，new_string 填空字符串 \"\"。",
    );
  }
  const oldString = input.old_string;

  let newString: string;
  if (input.new_string === null || input.new_string === undefined) {
    // 部分 provider / 审批链路会丢掉空串字段
    newString = "";
  } else if (typeof input.new_string === "string") {
    newString = input.new_string;
  } else {
    throw new Error("new_string 必须是字符串（删除时用空字符串 \"\"）。");
  }

  if (oldString.length === 0) {
    throw new Error(
      "old_string 不能为空。删除请把要删除的原文放入 old_string，并将 new_string 设为 \"\"（空字符串）；创建新文件请用 write_file。",
    );
  }
  if (oldString === newString) {
    throw new Error("old_string 与 new_string 完全相同，拒绝无效编辑。");
  }

  return { oldString, newString };
}

/**
 * 在绑定 roots 上对单个文本文件做精确替换。
 */
export async function executeHostEditFile(
  roots: readonly WorkspaceRoot[],
  input: HostEditFileInput,
): Promise<HostEditFileResult> {
  const filePath = input.filePath;
  const { oldString, newString } = normalizeEditStrings({
    old_string: input.old_string,
    new_string: input.new_string,
  });
  const replaceAll = input.replace_all === true;
  const mode: "replace" | "delete" = newString.length === 0 ? "delete" : "replace";

  let hostPath: string;
  let logicalPath: string;
  try {
    const resolved = await resolveWorkspacePath(filePath, roots);
    hostPath = resolved.hostPath;
    logicalPath = resolved.logicalPath;
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      throw new Error(`路径拒绝：${err.message}`);
    }
    throw err;
  }

  let raw: string;
  try {
    raw = await readFile(hostPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`无法读取文件 ${logicalPath}：${msg}`);
  }

  if (raw.includes("\0")) {
    throw new Error(
      `文件 "${logicalPath}" 含 NUL 字节，疑似二进制；edit_file 仅支持 UTF-8 文本。`,
    );
  }

  // 模型不会在 old_string 里带 BOM；匹配前剥离，写回时保留
  const { bom, text: before } = stripBom(raw);
  const matchCount = countOccurrences(before, oldString);
  if (matchCount === 0) {
    throw new Error(
      `old_string 未在文件中找到：${logicalPath}。请重新 read_file，确认原文完全一致并必要时扩大上下文。`,
    );
  }
  if (matchCount > 1 && !replaceAll) {
    throw new Error(
      `old_string 在文件中出现 ${matchCount} 次，默认拒绝替换。请加长 old_string 使匹配唯一，或设置 replace_all=true 全部替换。`,
    );
  }

  // 字面量替换（非正则）；newString 为空即删除匹配片段
  const after = replaceAll
    ? before.split(oldString).join(newString)
    : before.replace(oldString, newString);

  if (after === before) {
    // 理论上 matchCount>0 且 old≠new 时不可达；防御误报成功
    throw new Error(
      `编辑后内容未变化：${logicalPath}（mode=${mode}）。请检查 old_string/new_string。`,
    );
  }

  const finalContent = bom + after;
  try {
    await writeFile(hostPath, finalContent, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`写入失败 ${logicalPath}：${msg}`);
  }

  // 回读校验：防止「报告成功但磁盘未变」
  let verified: string;
  try {
    verified = await readFile(hostPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`写入后回读失败 ${logicalPath}：${msg}`);
  }
  if (verified !== finalContent) {
    throw new Error(
      `写入后回读与预期不一致：${logicalPath}。可能被其它进程覆盖，或磁盘写入未生效。`,
    );
  }

  const bytesBefore = Buffer.byteLength(raw, "utf8");
  const bytesAfter = Buffer.byteLength(finalContent, "utf8");

  return {
    filePath: logicalPath,
    hostPath,
    mode,
    changed: true,
    matchCount,
    replaceAll,
    bytesBefore,
    bytesAfter,
    bytesDelta: bytesAfter - bytesBefore,
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}
