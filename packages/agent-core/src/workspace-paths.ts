import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceRoot } from "./workspace-binding";

export const WORKSPACE_LOGICAL_PREFIX = "/workspace/";

export class WorkspacePathError extends Error {
  readonly code:
    | "unbound"
    | "invalid_shape"
    | "unknown_alias"
    | "escape"
    | "not_found";

  constructor(
    code: WorkspacePathError["code"],
    message: string,
  ) {
    super(message);
    this.name = "WorkspacePathError";
    this.code = code;
  }
}

export type ResolvedWorkspacePath = {
  readonly logicalPath: string;
  readonly alias: string;
  readonly relativePosix: string;
  readonly hostPath: string;
  readonly root: WorkspaceRoot;
};

function isDriveOrUncOrDevice(input: string): boolean {
  const s = input.trim();
  if (/^[A-Za-z]:[\\/]/.test(s)) return true;
  if (s.startsWith("\\\\") || s.startsWith("//")) return true;
  if (/^\\\\[.?]\\/.test(s) || s.startsWith("\\\\.\\") || s.startsWith("\\\\?\\")) {
    return true;
  }
  // Windows 设备路径 / 裸盘符
  if (/^[A-Za-z]:$/.test(s)) return true;
  return false;
}

/**
 * 将工具侧路径规范为逻辑绝对路径 `/workspace/<alias>/...`（POSIX 风格）。
 */
export function normalizeLogicalWorkspacePath(input: string): string {
  const raw = input.trim().replace(/\\/g, "/");
  if (!raw) {
    throw new WorkspacePathError("invalid_shape", "路径不能为空。");
  }
  if (isDriveOrUncOrDevice(raw) || isDriveOrUncOrDevice(input)) {
    throw new WorkspacePathError(
      "invalid_shape",
      `拒绝盘符、UNC 或设备路径：${input}`,
    );
  }
  // 相对路径锚定到 /workspace
  let logical = raw.startsWith("/") ? raw : `/workspace/${raw}`;
  // 折叠重复斜杠
  logical = logical.replace(/\/+/g, "/");
  if (!logical.startsWith(WORKSPACE_LOGICAL_PREFIX) && logical !== "/workspace") {
    throw new WorkspacePathError(
      "invalid_shape",
      `路径必须位于 /workspace/<alias>/... 之下：${input}`,
    );
  }
  // 解析 . 与 ..（仅逻辑段，不触达宿主）
  const parts = logical.split("/").filter((p) => p.length > 0);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (stack.length <= 1) {
        // 不允许跳出 /workspace
        throw new WorkspacePathError(
          "escape",
          `路径越界（逻辑 ..）：${input}`,
        );
      }
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return `/${stack.join("/")}`;
}

function splitAlias(logicalPath: string): { alias: string; rest: string } {
  const normalized = normalizeLogicalWorkspacePath(logicalPath);
  if (normalized === "/workspace") {
    throw new WorkspacePathError(
      "invalid_shape",
      "必须指定 /workspace/<alias>/...，不能只写 /workspace。",
    );
  }
  const without = normalized.slice(WORKSPACE_LOGICAL_PREFIX.length);
  const slash = without.indexOf("/");
  if (slash < 0) {
    return { alias: without, rest: "" };
  }
  return {
    alias: without.slice(0, slash),
    rest: without.slice(slash + 1),
  };
}

function comparableHost(p: string): string {
  return path.win32.normalize(p).replace(/[\\/]+$/, "").toLowerCase();
}

function isInsideRoot(hostPath: string, rootCanonical: string): boolean {
  const h = comparableHost(hostPath);
  const r = comparableHost(rootCanonical);
  if (h === r) return true;
  const prefix = r.endsWith("\\") ? r : `${r}\\`;
  return h.startsWith(prefix);
}

/**
 * 解析逻辑路径到宿主绝对路径，并做 realpath/最近存在父目录 containment。
 */
export async function resolveWorkspacePath(
  logicalInput: string,
  roots: readonly WorkspaceRoot[],
): Promise<ResolvedWorkspacePath> {
  if (!roots || roots.length === 0) {
    throw new WorkspacePathError("unbound", "工作区尚未绑定，拒绝路径解析。");
  }

  const logicalPath = normalizeLogicalWorkspacePath(logicalInput);
  const { alias, rest } = splitAlias(logicalPath);
  const root = roots.find((r) => r.alias === alias);
  if (!root) {
    throw new WorkspacePathError(
      "unknown_alias",
      `未知工作区别名：${alias}`,
    );
  }

  const hostPath = rest
    ? path.win32.resolve(root.canonicalPath, rest.split("/").join(path.win32.sep))
    : root.canonicalPath;

  if (!isInsideRoot(hostPath, root.canonicalPath)) {
    throw new WorkspacePathError(
      "escape",
      `路径解析后越出根目录：${logicalPath}`,
    );
  }

  // realpath / 最近存在父目录复核（防 symlink / reparse 逃逸）
  await assertHostContainment(hostPath, root.canonicalPath);

  return {
    logicalPath,
    alias,
    relativePosix: rest,
    hostPath,
    root,
  };
}

async function assertHostContainment(
  hostPath: string,
  rootCanonical: string,
): Promise<void> {
  let rootReal: string;
  try {
    rootReal = await realpath(rootCanonical);
  } catch {
    throw new WorkspacePathError(
      "not_found",
      `工作区根目录不可用：${rootCanonical}`,
    );
  }

  // 自 hostPath 向上找最近存在节点
  let probe = hostPath;
  let found: string | null = null;
  for (;;) {
    try {
      await lstat(probe);
      found = probe;
      break;
    } catch {
      const parent = path.win32.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }

  if (!found) {
    throw new WorkspacePathError(
      "escape",
      `无法定位路径以做 containment 检查：${hostPath}`,
    );
  }

  let realFound: string;
  try {
    realFound = await realpath(found);
  } catch {
    throw new WorkspacePathError(
      "escape",
      `realpath 失败，拒绝访问：${found}`,
    );
  }

  if (!isInsideRoot(realFound, rootReal)) {
    throw new WorkspacePathError(
      "escape",
      `路径经 reparse/symlink 解析后越出绑定根：${hostPath}`,
    );
  }

  // 若目标已存在，再对自身 realpath 复核
  try {
    const st = await stat(hostPath);
    if (st) {
      const realTarget = await realpath(hostPath);
      if (!isInsideRoot(realTarget, rootReal)) {
        throw new WorkspacePathError(
          "escape",
          `目标路径 realpath 越界：${hostPath}`,
        );
      }
    }
  } catch (err) {
    if (err instanceof WorkspacePathError) throw err;
    // 不存在则仅父目录检查已足够
  }
}

/** 同步形态的快速拒绝（不触盘）；用于工具入参预检。 */
export function assertLogicalPathShape(input: string): string {
  return normalizeLogicalWorkspacePath(input);
}
