/**
 * 宿主原生 glob / grep：不经 sandbox.run。
 *
 * Eve 默认 glob/grep 内部 `await session.run({ command: rg|find|grep })`，
 * host-workspace 禁用 run 后会固定失败（DEF-006）。本模块在绑定 roots 上
 * 用 Node FS 遍历 + path.matchesGlob / RegExp 完成检索，并保持逻辑路径输出。
 */

import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceRoot } from "./workspace-binding";
import {
  normalizeLogicalWorkspacePath,
  resolveWorkspacePath,
  WorkspacePathError,
  WORKSPACE_LOGICAL_PREFIX,
} from "./workspace-paths";

/** 与 Eve truncate-output 对齐：约 50KiB 输出预算。 */
const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_LINE_LENGTH = 2000;
const LINE_TRUNCATION_SUFFIX = " [truncated]";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
/** 单文件读入上限，防止把巨大二进制当文本扫。 */
const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;

export type HostGlobInput = {
  readonly pattern: string;
  readonly path?: string;
  readonly limit?: number;
};

export type HostGlobResult = {
  readonly content: string;
  readonly count: number;
  readonly path: string;
  readonly truncated: boolean;
};

export type HostGrepInput = {
  readonly pattern: string;
  readonly path?: string;
  readonly glob?: string;
  readonly ignoreCase?: boolean;
  readonly literal?: boolean;
  readonly limit?: number;
  readonly context?: number;
};

export type HostGrepResult = {
  readonly content: string;
  readonly matchCount: number;
  readonly path: string;
  readonly truncated: boolean;
};

type SearchTarget = {
  /** 工具结果里展示的逻辑基路径 */
  readonly logicalBase: string;
  readonly hostPath: string;
  readonly root: WorkspaceRoot;
  readonly isFile: boolean;
};

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);
}

function capLineLength(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) return line;
  return `${line.slice(0, MAX_LINE_LENGTH)}${LINE_TRUNCATION_SUFFIX}`;
}

function toPosixRelative(hostRelative: string): string {
  return hostRelative.replace(/\\/g, "/");
}

/**
 * Eve/rg 风格：无斜杠的 `*.ts` 应匹配任意深度；Node matchesGlob 的 `*.ts` 只匹配顶层。
 */
export function expandBareGlobPattern(pattern: string): string {
  const p = pattern.trim();
  if (!p) return p;
  if (p.includes("/") || p.startsWith("**/")) return p;
  return `**/${p}`;
}

function shouldSkipDirName(name: string): boolean {
  return name === ".git" || name === "node_modules";
}

/**
 * 解析检索起点：省略或仅 `/workspace` → 全部绑定根；否则走 containment。
 */
async function resolveSearchTargets(
  roots: readonly WorkspaceRoot[],
  logicalInput: string | undefined,
): Promise<{ displayPath: string; targets: SearchTarget[] }> {
  if (!roots.length) {
    throw new WorkspacePathError("unbound", "工作区尚未绑定，拒绝检索。");
  }

  const raw = logicalInput?.trim();
  if (!raw || raw === "/workspace" || raw === "/workspace/") {
    const targets: SearchTarget[] = [];
    for (const root of roots) {
      let st;
      try {
        st = await stat(root.canonicalPath);
      } catch {
        throw new WorkspacePathError(
          "not_found",
          `工作区根目录不可用：${root.displayPath}`,
        );
      }
      targets.push({
        logicalBase: `${WORKSPACE_LOGICAL_PREFIX}${root.alias}`,
        hostPath: root.canonicalPath,
        root,
        isFile: st.isFile(),
      });
    }
    return { displayPath: "/workspace", targets };
  }

  let logicalPath: string;
  try {
    logicalPath = normalizeLogicalWorkspacePath(raw);
  } catch (err) {
    if (err instanceof WorkspacePathError) throw err;
    throw err;
  }

  const resolved = await resolveWorkspacePath(logicalPath, roots);
  let st;
  try {
    st = await stat(resolved.hostPath);
  } catch {
    throw new Error(`路径不存在：${resolved.logicalPath}`);
  }

  return {
    displayPath: resolved.logicalPath,
    targets: [
      {
        logicalBase: resolved.logicalPath,
        hostPath: resolved.hostPath,
        root: resolved.root,
        isFile: st.isFile(),
      },
    ],
  };
}

/**
 * 将宿主绝对路径还原为逻辑路径（须仍在同一 root 内）。
 */
function hostPathToLogical(
  hostAbs: string,
  root: WorkspaceRoot,
): string | null {
  const rootCmp = path.win32
    .normalize(root.canonicalPath)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
  const hostCmp = path.win32.normalize(hostAbs).replace(/[\\/]+$/, "");
  const hostLower = hostCmp.toLowerCase();
  if (hostLower === rootCmp) {
    return `${WORKSPACE_LOGICAL_PREFIX}${root.alias}`;
  }
  const prefix = rootCmp.endsWith("\\") ? rootCmp : `${rootCmp}\\`;
  if (!hostLower.startsWith(prefix)) return null;
  const rel = hostCmp.slice(prefix.length);
  const posix = toPosixRelative(rel);
  return posix
    ? `${WORKSPACE_LOGICAL_PREFIX}${root.alias}/${posix}`
    : `${WORKSPACE_LOGICAL_PREFIX}${root.alias}`;
}

/**
 * 在 target 下递归收集匹配文件的逻辑路径（深度优先，跳过 .git / node_modules）。
 * childRel 相对检索起点；逻辑路径 = target.logicalBase + childRel（子目录检索不得丢中间段）。
 */
async function* walkMatchingFiles(
  target: SearchTarget,
  fileGlob: string | undefined,
  abortSignal?: AbortSignal,
): AsyncGenerator<string> {
  const matchPattern = fileGlob ? expandBareGlobPattern(fileGlob) : "**/*";
  const logicalBase = target.logicalBase.replace(/\/+$/, "");

  const toLogical = (relPosix: string): string =>
    relPosix ? `${logicalBase}/${relPosix}` : logicalBase;

  if (target.isFile) {
    const logical = hostPathToLogical(target.hostPath, target.root);
    if (!logical) return;
    const baseName = path.win32.basename(target.hostPath);
    // 单文件：相对检索起点的名字即为 basename
    if (
      path.matchesGlob(baseName, matchPattern) ||
      path.matchesGlob(logical, matchPattern)
    ) {
      yield logical;
    }
    return;
  }

  async function* walkDir(
    hostDir: string,
    relPosix: string,
  ): AsyncGenerator<string> {
    if (abortSignal?.aborted) {
      throw new Error("检索已取消。");
    }
    let entries;
    try {
      entries = await readdir(hostDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (abortSignal?.aborted) {
        throw new Error("检索已取消。");
      }
      const name = entry.name;
      if (shouldSkipDirName(name)) continue;
      const childHost = path.win32.join(hostDir, name);
      const childRel = relPosix ? `${relPosix}/${name}` : name;
      const childLogical = toLogical(childRel);

      // 目录：继续深入；junction/symlink 目录若 realpath 越界则跳过
      if (entry.isDirectory()) {
        if (entry.isSymbolicLink()) {
          try {
            await resolveWorkspacePath(childLogical, [target.root]);
          } catch {
            continue;
          }
        }
        yield* walkDir(childHost, childRel);
        continue;
      }

      if (!entry.isFile() && !entry.isSymbolicLink()) continue;

      // 文件：glob 匹配相对检索起点的路径 + containment
      if (
        !path.matchesGlob(childRel, matchPattern) &&
        !path.matchesGlob(name, matchPattern)
      ) {
        continue;
      }

      try {
        await resolveWorkspacePath(childLogical, [target.root]);
      } catch {
        continue;
      }

      yield childLogical;
    }
  }

  yield* walkDir(target.hostPath, "");
}

/**
 * 宿主 glob：返回逻辑路径列表，契约对齐 Eve GlobResult。
 */
export async function executeHostGlob(
  roots: readonly WorkspaceRoot[],
  input: HostGlobInput,
  options?: { readonly abortSignal?: AbortSignal },
): Promise<HostGlobResult> {
  const pattern = input.pattern?.trim();
  if (!pattern) {
    throw new Error("glob pattern 不能为空。");
  }

  const limit = clampLimit(input.limit);
  let displayPath: string;
  let targets: SearchTarget[];
  try {
    ({ displayPath, targets } = await resolveSearchTargets(roots, input.path));
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      throw new Error(`路径拒绝：${err.message}`);
    }
    throw err;
  }

  const matches: string[] = [];
  let hitLimit = false;
  let byteBudget = 0;
  let byteTruncated = false;

  outer: for (const target of targets) {
    for await (const logical of walkMatchingFiles(
      target,
      pattern,
      options?.abortSignal,
    )) {
      if (matches.length >= limit) {
        hitLimit = true;
        break outer;
      }
      const line = logical;
      const cost = Buffer.byteLength(line, "utf8") + 1;
      if (byteBudget + cost > MAX_OUTPUT_BYTES && matches.length > 0) {
        byteTruncated = true;
        break outer;
      }
      matches.push(line);
      byteBudget += cost;
    }
  }

  if (matches.length === 0) {
    return {
      content: "No files found",
      count: 0,
      path: displayPath,
      truncated: false,
    };
  }

  const truncated = hitLimit || byteTruncated;
  const lines = [...matches];
  if (truncated) {
    lines.push("");
    lines.push(
      `(Results truncated: showing first ${matches.length} results out of more. Use a more specific path or pattern to narrow results.)`,
    );
  }

  return {
    content: lines.join("\n"),
    count: matches.length,
    path: displayPath,
    truncated,
  };
}

function compileGrepPattern(
  pattern: string,
  opts: { ignoreCase: boolean; literal: boolean },
): RegExp {
  if (opts.literal) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, opts.ignoreCase ? "i" : undefined);
  }
  try {
    return new RegExp(pattern, opts.ignoreCase ? "i" : undefined);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`无效的正则 pattern：${msg}`);
  }
}

async function isProbablyBinaryFile(hostPath: string): Promise<boolean> {
  let fh;
  try {
    fh = await open(hostPath, "r");
    const buf = Buffer.alloc(8000);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    for (let i = 0; i < bytesRead; i += 1) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/**
 * 宿主 grep：行级内容搜索，输出 `path:line:text`，契约对齐 Eve GrepResult。
 */
export async function executeHostGrep(
  roots: readonly WorkspaceRoot[],
  input: HostGrepInput,
  options?: { readonly abortSignal?: AbortSignal },
): Promise<HostGrepResult> {
  const pattern = input.pattern;
  if (pattern === undefined || pattern === null || String(pattern).length === 0) {
    throw new Error("grep pattern 不能为空。");
  }

  const limit = clampLimit(input.limit);
  const contextLines = Math.max(0, input.context ?? 0);
  const ignoreCase = input.ignoreCase ?? false;
  const literal = input.literal ?? false;
  const re = compileGrepPattern(String(pattern), { ignoreCase, literal });

  let displayPath: string;
  let targets: SearchTarget[];
  try {
    ({ displayPath, targets } = await resolveSearchTargets(roots, input.path));
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      throw new Error(`路径拒绝：${err.message}`);
    }
    throw err;
  }

  const outputLines: string[] = [];
  let matchCount = 0;
  let byteBudget = 0;
  let truncated = false;
  let needSeparator = false;

  const pushLine = (text: string): boolean => {
    const capped = capLineLength(text);
    const cost = Buffer.byteLength(capped, "utf8") + 1;
    if (byteBudget + cost > MAX_OUTPUT_BYTES && outputLines.length > 0) {
      truncated = true;
      return false;
    }
    outputLines.push(capped);
    byteBudget += cost;
    return true;
  };

  outer: for (const target of targets) {
    for await (const logical of walkMatchingFiles(
      target,
      input.glob,
      options?.abortSignal,
    )) {
      if (options?.abortSignal?.aborted) {
        throw new Error("检索已取消。");
      }

      // 反查宿主路径：已由 walk 做过 containment
      let hostFile: string;
      try {
        const resolved = await resolveWorkspacePath(logical, roots);
        hostFile = resolved.hostPath;
      } catch {
        continue;
      }

      let st;
      try {
        st = await stat(hostFile);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size > MAX_GREP_FILE_BYTES) continue;
      if (await isProbablyBinaryFile(hostFile)) continue;

      let text: string;
      try {
        text = await readFile(hostFile, "utf8");
      } catch {
        continue;
      }

      const fileLines = text.split(/\r?\n/);
      // 去掉 split 产生的末尾空段（文件以换行结束时）
      if (fileLines.length > 0 && fileLines[fileLines.length - 1] === "") {
        fileLines.pop();
      }

      const matchLineIndexes: number[] = [];
      for (let i = 0; i < fileLines.length; i += 1) {
        if (re.test(fileLines[i] ?? "")) {
          matchLineIndexes.push(i);
          // 重置 lastIndex（若有 g flag 时）；本处无 g
          re.lastIndex = 0;
        } else {
          re.lastIndex = 0;
        }
      }
      if (matchLineIndexes.length === 0) continue;

      // 合并 context 窗口
      type Window = { start: number; end: number; matches: Set<number> };
      const windows: Window[] = [];
      for (const idx of matchLineIndexes) {
        if (matchCount >= limit) {
          truncated = true;
          break;
        }
        matchCount += 1;
        const start = Math.max(0, idx - contextLines);
        const end = Math.min(fileLines.length - 1, idx + contextLines);
        const last = windows[windows.length - 1];
        if (last && start <= last.end + 1) {
          last.end = Math.max(last.end, end);
          last.matches.add(idx);
        } else {
          windows.push({ start, end, matches: new Set([idx]) });
        }
        if (matchCount >= limit) {
          truncated = true;
          // 当前 match 已计入窗口
        }
      }

      for (const win of windows) {
        if (needSeparator && contextLines > 0) {
          if (!pushLine("--")) break outer;
        }
        for (let i = win.start; i <= win.end; i += 1) {
          const isMatch = win.matches.has(i);
          const sep = isMatch || contextLines === 0 ? ":" : "-";
          // 无 context 时只输出匹配行
          if (contextLines === 0 && !isMatch) continue;
          const body = fileLines[i] ?? "";
          if (!pushLine(`${logical}${sep}${i + 1}${sep}${body}`)) {
            break outer;
          }
        }
        needSeparator = true;
      }

      if (matchCount >= limit) {
        truncated = true;
        break outer;
      }
    }
  }

  if (matchCount === 0 && outputLines.length === 0) {
    return {
      content: "No matches found",
      matchCount: 0,
      path: displayPath,
      truncated: false,
    };
  }

  let content = outputLines.join("\n");
  if (truncated) {
    const notes: string[] = [];
    if (matchCount >= limit) {
      notes.push(
        `Match limit reached (${limit}). Use a larger limit or more specific pattern.`,
      );
    }
    if (byteBudget >= MAX_OUTPUT_BYTES || truncated) {
      notes.push(
        "Output truncated due to size. Use a more specific path or pattern.",
      );
    }
    // 去重
    const unique = [...new Set(notes)];
    content += `\n\n[${unique.join(" ")}]`;
  }

  return {
    content,
    matchCount,
    path: displayPath,
    truncated,
  };
}
