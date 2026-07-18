import type { AgentId } from "./model-catalog";

/** 服务端权威根目录（含 canonicalPath；不得下发给浏览器）。 */
export type WorkspaceRoot = {
  readonly alias: string;
  readonly canonicalPath: string;
  readonly displayPath: string;
};

/** API / 浏览器可见的根目录（省略 canonicalPath）。 */
export type WorkspaceRootPublic = {
  readonly alias: string;
  readonly displayPath: string;
};

export type CreateBindingRequest = {
  readonly agentId: AgentId;
  /** Windows 绝对路径列表，至少一个 */
  readonly roots: readonly string[];
};

export type CreateBindingResponse = {
  readonly workspaceId: string;
  readonly agentId: AgentId;
  readonly roots: readonly WorkspaceRootPublic[];
  /** 仅创建时返回一次的明文 capability，不落库 */
  readonly capability: string;
};

export type WorkspaceBindingRecord = {
  readonly workspaceId: string;
  readonly agentId: AgentId;
  readonly roots: readonly WorkspaceRoot[];
  readonly capabilityDigest: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
};

/**
 * 服务端派生的「最近绑定目录集合」（仅 displayPath，无 canonical / capability）。
 * 供绑定表单回显，避免每次手输。
 */
export type RecentRootSetPublic = {
  /** 有序展示路径（与最近一次成功绑定的 roots 顺序一致） */
  readonly paths: readonly string[];
  /** 最近一次使用该集合的时间（ISO-8601，来自 binding.created_at） */
  readonly usedAt: string;
};

export type WorkspaceStoreErrorCode =
  | "invalid_agent"
  | "invalid_roots"
  | "overlapping_roots"
  | "directory_unavailable"
  | "database_error"
  | "not_found"
  | "revoked";

export class WorkspaceStoreError extends Error {
  readonly code: WorkspaceStoreErrorCode;

  constructor(code: WorkspaceStoreErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceStoreError";
    this.code = code;
  }
}
