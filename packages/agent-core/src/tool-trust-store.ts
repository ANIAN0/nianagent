/**
 * 会话权限与持久信任规则存储。
 * 写路径仅 Next（withWritableDb + migrate）；Agent 仅只读短连接 SELECT。
 * 禁止写入 last_used_at；禁止存明文 capability。
 * 持久规则按内容键幂等固化；变更时递增 rules epoch 供 Agent 热缓存失效。
 */
import { createHash } from "node:crypto";
import type { Database } from "@tursodatabase/database";
import type { AgentId } from "./model-catalog";
import { AGENT_IDS } from "./model-catalog";
import { normalizeLogicalWorkspacePath } from "./workspace-paths";
import {
  defaultWorkspaceDbPath,
  withReadableDb,
  withWritableDb,
  WorkspaceStoreError,
} from "./workspace-store";

/** 本期可记入持久规则 / 会话 grant 的工具名（bare）。 */
export const TRUSTABLE_TOOL_NAMES = [
  "write_file",
  "edit_file",
  "powershell",
] as const;

export type TrustableToolName = (typeof TRUSTABLE_TOOL_NAMES)[number];

export type SessionPermissionState = {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly agentId: AgentId;
  readonly acceptEdits: boolean;
  readonly globalBypass: boolean;
  readonly sessionToolGrants: readonly string[];
  readonly updatedAt: string;
};

export type ToolTrustRule = {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentId: AgentId;
  readonly toolName: TrustableToolName;
  readonly matchType: "exact";
  readonly pattern: string;
  readonly logicalCwd: string | null;
  readonly enabled: boolean;
  readonly createdAt: string;
};

/** 创建/幂等固化结果：规则行 + 当前 workspace+agent 的规则世代。 */
export type CreateToolTrustRuleResult = {
  readonly rule: ToolTrustRule;
  /** 写入后的 rules epoch；Agent 热缓存按此世代校验失效。 */
  readonly rulesEpoch: number;
};

/**
 * 规则内容确定性 id（sha256 hex）。
 * 同内容重复固化命中同一主键，配合 ON CONFLICT 幂等。
 */
export function buildToolTrustRuleContentId(input: {
  readonly workspaceId: string;
  readonly agentId: string;
  readonly toolName: string;
  readonly pattern: string;
  readonly logicalCwd: string | null;
}): string {
  const payload = [
    input.workspaceId.trim(),
    input.agentId,
    input.toolName,
    "exact",
    input.pattern,
    input.logicalCwd ?? "",
  ].join("\0");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export type ToolTrustErrorCode =
  | "invalid_session"
  | "invalid_agent"
  | "invalid_tool"
  | "invalid_pattern"
  | "overbroad_rule"
  | "triple_mismatch"
  | "not_found"
  | "conflict"
  | "database_error";

export class ToolTrustStoreError extends Error {
  readonly code: ToolTrustErrorCode;

  constructor(code: ToolTrustErrorCode, message: string) {
    super(message);
    this.name = "ToolTrustStoreError";
    this.code = code;
  }
}

type SessionRow = {
  session_id: string;
  workspace_id: string;
  agent_id: string;
  accept_edits: number;
  global_bypass: number;
  session_tool_grants_json: string;
  updated_at: string;
};

type RuleRow = {
  id: string;
  workspace_id: string;
  agent_id: string;
  tool_name: string;
  match_type: string;
  pattern: string;
  logical_cwd: string | null;
  enabled: number;
  created_at: string;
};

function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && (AGENT_IDS as readonly string[]).includes(value);
}

export function isTrustableToolName(value: unknown): value is TrustableToolName {
  return (
    typeof value === "string" &&
    (TRUSTABLE_TOOL_NAMES as readonly string[]).includes(value)
  );
}

/** 拒绝空 session 与明显占位 id（无真实 Eve session 不得写行）。 */
export function assertRealSessionId(sessionId: unknown): string {
  if (typeof sessionId !== "string") {
    throw new ToolTrustStoreError("invalid_session", "sessionId 必须是字符串。");
  }
  const id = sessionId.trim();
  if (!id) {
    throw new ToolTrustStoreError("invalid_session", "sessionId 不能为空。");
  }
  const lower = id.toLowerCase();
  if (
    lower === "pending" ||
    lower === "temp" ||
    lower === "temporary" ||
    lower === "new" ||
    lower === "null" ||
    lower === "undefined" ||
    lower.startsWith("local-") ||
    lower.startsWith("fake-")
  ) {
    throw new ToolTrustStoreError(
      "invalid_session",
      "sessionId 必须是真实 Eve 会话 id，拒绝占位值。",
    );
  }
  return id;
}

/**
 * 逻辑 cwd / 文件路径：NFC + normalizeLogicalWorkspacePath。
 * 空串返回 null（调用方再判必填）。
 */
export function normalizeTrustLogicalPath(input: string): string {
  const nfc = input.normalize("NFC").trim();
  return normalizeLogicalWorkspacePath(nfc);
}

/** command exact：NFC；不折叠内部空白。 */
export function normalizeCommandExact(command: string): string {
  return command.normalize("NFC");
}

/**
 * 保存期过宽/非法校验。
 * - 空 pattern
 * - 文件类仅 `/workspace` 或仅 `/workspace/<alias>` 根
 * - 非法 tool 名
 * - powershell 缺 logicalCwd
 */
export function validateTrustRuleInput(input: {
  readonly toolName: unknown;
  readonly pattern: unknown;
  readonly logicalCwd?: unknown;
  readonly matchType?: unknown;
}): {
  toolName: TrustableToolName;
  pattern: string;
  logicalCwd: string | null;
  matchType: "exact";
} {
  if (!isTrustableToolName(input.toolName)) {
    throw new ToolTrustStoreError(
      "invalid_tool",
      `toolName 必须是 ${TRUSTABLE_TOOL_NAMES.join(" | ")} 之一。`,
    );
  }
  if (input.matchType != null && input.matchType !== "exact") {
    throw new ToolTrustStoreError(
      "invalid_pattern",
      "本期 matchType 仅允许 exact。",
    );
  }
  if (typeof input.pattern !== "string") {
    throw new ToolTrustStoreError("invalid_pattern", "pattern 必须是字符串。");
  }

  const toolName = input.toolName;
  if (toolName === "powershell") {
    const pattern = normalizeCommandExact(input.pattern);
    if (!pattern.trim()) {
      throw new ToolTrustStoreError(
        "overbroad_rule",
        "PowerShell 规则的 command 不能为空。",
      );
    }
    if (typeof input.logicalCwd !== "string" || !input.logicalCwd.trim()) {
      throw new ToolTrustStoreError(
        "invalid_pattern",
        "PowerShell 规则必须提供 logicalCwd（逻辑工作目录）。",
      );
    }
    let logicalCwd: string;
    try {
      logicalCwd = normalizeTrustLogicalPath(input.logicalCwd);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ToolTrustStoreError(
        "invalid_pattern",
        `logicalCwd 无效：${message}`,
      );
    }
    return {
      toolName,
      pattern,
      logicalCwd,
      matchType: "exact",
    };
  }

  // 文件类：write_file / edit_file — pattern 为逻辑路径 exact
  let pattern: string;
  try {
    pattern = normalizeTrustLogicalPath(input.pattern);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolTrustStoreError("invalid_pattern", `pattern 无效：${message}`);
  }
  if (isOverbroadFileLogicalPath(pattern)) {
    throw new ToolTrustStoreError(
      "overbroad_rule",
      "文件信任规则过宽：不能仅为 /workspace 或 /workspace/<alias> 根，请指定具体文件路径。",
    );
  }
  return {
    toolName,
    pattern,
    logicalCwd: null,
    matchType: "exact",
  };
}

/** 仅 /workspace 或仅 /workspace/<alias>（无更深路径）视为过宽。 */
export function isOverbroadFileLogicalPath(logicalPath: string): boolean {
  if (logicalPath === "/workspace") return true;
  const prefix = "/workspace/";
  if (!logicalPath.startsWith(prefix)) return true;
  const rest = logicalPath.slice(prefix.length);
  if (!rest || rest === "/") return true;
  // 无子路径段：只有 alias
  const parts = rest.split("/").filter((p) => p.length > 0);
  return parts.length <= 1;
}

function parseGrantsJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .map((x) => x.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function rowToSessionState(row: SessionRow): SessionPermissionState {
  if (!isAgentId(row.agent_id)) {
    throw new ToolTrustStoreError(
      "database_error",
      `session_permission_state.agent_id 无效：${row.agent_id}`,
    );
  }
  return {
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    acceptEdits: row.accept_edits === 1,
    globalBypass: row.global_bypass === 1,
    sessionToolGrants: parseGrantsJson(row.session_tool_grants_json),
    updatedAt: row.updated_at,
  };
}

function rowToRule(row: RuleRow): ToolTrustRule {
  if (!isAgentId(row.agent_id)) {
    throw new ToolTrustStoreError(
      "database_error",
      `tool_trust_rules.agent_id 无效：${row.agent_id}`,
    );
  }
  if (!isTrustableToolName(row.tool_name)) {
    throw new ToolTrustStoreError(
      "database_error",
      `tool_trust_rules.tool_name 无效：${row.tool_name}`,
    );
  }
  if (row.match_type !== "exact") {
    throw new ToolTrustStoreError(
      "database_error",
      `tool_trust_rules.match_type 无效：${row.match_type}`,
    );
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    toolName: row.tool_name,
    matchType: "exact",
    pattern: row.pattern,
    logicalCwd: row.logical_cwd,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

function isMissingTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such table/i.test(message);
}

function defaultEmptySession(
  sessionId: string,
  workspaceId: string,
  agentId: AgentId,
): SessionPermissionState {
  return {
    sessionId,
    workspaceId,
    agentId,
    acceptEdits: false,
    globalBypass: false,
    sessionToolGrants: [],
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * Agent 只读：三元组不匹配或无行 → null（策略侧视为无授权行）。
 * 不执行 migration；表尚未创建时返回 null。
 */
export async function getSessionPermissionReadonly(
  sessionId: string,
  workspaceId: string,
  agentId: AgentId,
  options?: { readonly dbPath?: string },
): Promise<SessionPermissionState | null> {
  const id = sessionId.trim();
  if (!id || !workspaceId || !isAgentId(agentId)) return null;
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();
  try {
    return await withReadableDb(dbPath, async (db) => {
      const row = (await db
        .prepare(
          `SELECT session_id, workspace_id, agent_id, accept_edits, global_bypass,
                  session_tool_grants_json, updated_at
           FROM session_permission_state WHERE session_id = ?`,
        )
        .get(id)) as SessionRow | undefined;
      if (!row) return null;
      if (row.workspace_id !== workspaceId || row.agent_id !== agentId) {
        return null;
      }
      return rowToSessionState(row);
    });
  } catch (err) {
    if (err instanceof WorkspaceStoreError && err.code === "database_error") {
      if (/尚不存在/.test(err.message) || isMissingTableError(err)) return null;
    }
    if (isMissingTableError(err)) return null;
    if (err instanceof ToolTrustStoreError) throw err;
    throw err;
  }
}

/**
 * Next GET：无行 → 默认全关空 grants；三元组错配 → triple_mismatch。
 */
export async function getSessionPermissionForApi(
  sessionId: string,
  workspaceId: string,
  agentId: AgentId,
  options?: { readonly dbPath?: string },
): Promise<SessionPermissionState> {
  const id = assertRealSessionId(sessionId);
  if (!workspaceId) {
    throw new ToolTrustStoreError("triple_mismatch", "workspaceId 不能为空。");
  }
  if (!isAgentId(agentId)) {
    throw new ToolTrustStoreError("invalid_agent", `无效的 agentId：${String(agentId)}`);
  }
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();
  return withWritableDb(dbPath, async (db) => {
    const row = (await db
      .prepare(
        `SELECT session_id, workspace_id, agent_id, accept_edits, global_bypass,
                session_tool_grants_json, updated_at
         FROM session_permission_state WHERE session_id = ?`,
      )
      .get(id)) as SessionRow | undefined;
    if (!row) {
      return defaultEmptySession(id, workspaceId, agentId);
    }
    if (row.workspace_id !== workspaceId || row.agent_id !== agentId) {
      throw new ToolTrustStoreError(
        "triple_mismatch",
        "会话权限行与当前 workspace/agent 不匹配，拒绝返回。",
      );
    }
    return rowToSessionState(row);
  });
}

export type PatchSessionPermissionInput = {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly agentId: AgentId;
  readonly acceptEdits?: boolean;
  readonly globalBypass?: boolean;
  readonly grantTool?: string;
  readonly revokeTool?: string;
};

/**
 * Next PATCH：首次插入冻结三元组；更新时三元组必须匹配。
 * 关闭 acceptEdits / globalBypass 只改对应位，**不清** session_tool_grants_json。
 * grantTool 幂等追加；revokeTool 按名移除。
 */
export async function patchSessionPermission(
  input: PatchSessionPermissionInput,
  options?: { readonly dbPath?: string },
): Promise<SessionPermissionState> {
  const sessionId = assertRealSessionId(input.sessionId);
  if (!input.workspaceId?.trim()) {
    throw new ToolTrustStoreError("triple_mismatch", "workspaceId 不能为空。");
  }
  if (!isAgentId(input.agentId)) {
    throw new ToolTrustStoreError(
      "invalid_agent",
      `无效的 agentId：${String(input.agentId)}`,
    );
  }

  const workspaceId = input.workspaceId.trim();
  const agentId = input.agentId;
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();
  const updatedAt = new Date().toISOString();

  let grantTool: string | undefined;
  if (input.grantTool != null) {
    if (!isTrustableToolName(input.grantTool)) {
      throw new ToolTrustStoreError(
        "invalid_tool",
        `grantTool 必须是 ${TRUSTABLE_TOOL_NAMES.join(" | ")} 之一。`,
      );
    }
    grantTool = input.grantTool;
  }
  let revokeTool: string | undefined;
  if (input.revokeTool != null) {
    if (typeof input.revokeTool !== "string" || !input.revokeTool.trim()) {
      throw new ToolTrustStoreError("invalid_tool", "revokeTool 无效。");
    }
    revokeTool = input.revokeTool.trim();
  }

  return withWritableDb(dbPath, async (db) => {
    const existing = (await db
      .prepare(
        `SELECT session_id, workspace_id, agent_id, accept_edits, global_bypass,
                session_tool_grants_json, updated_at
         FROM session_permission_state WHERE session_id = ?`,
      )
      .get(sessionId)) as SessionRow | undefined;

    if (existing) {
      if (
        existing.workspace_id !== workspaceId ||
        existing.agent_id !== agentId
      ) {
        throw new ToolTrustStoreError(
          "conflict",
          "会话权限已绑定其它 workspace/agent，拒绝改绑。",
        );
      }

      const acceptEdits =
        input.acceptEdits !== undefined
          ? input.acceptEdits
            ? 1
            : 0
          : existing.accept_edits;
      const globalBypass =
        input.globalBypass !== undefined
          ? input.globalBypass
            ? 1
            : 0
          : existing.global_bypass;

      // 关闭模式位时不清 grants
      let grants = parseGrantsJson(existing.session_tool_grants_json);
      if (grantTool && !grants.includes(grantTool)) {
        grants = [...grants, grantTool];
      }
      if (revokeTool) {
        grants = grants.filter((g) => g !== revokeTool);
      }

      await db
        .prepare(
          `UPDATE session_permission_state
           SET accept_edits = ?, global_bypass = ?, session_tool_grants_json = ?, updated_at = ?
           WHERE session_id = ?`,
        )
        .run(
          acceptEdits,
          globalBypass,
          JSON.stringify(grants),
          updatedAt,
          sessionId,
        );

      return {
        sessionId,
        workspaceId,
        agentId,
        acceptEdits: acceptEdits === 1,
        globalBypass: globalBypass === 1,
        sessionToolGrants: grants,
        updatedAt,
      };
    }

    // 首次插入：冻结三元组
    const acceptEdits = input.acceptEdits ? 1 : 0;
    const globalBypass = input.globalBypass ? 1 : 0;
    let grants: string[] = [];
    if (grantTool) grants = [grantTool];
    // revoke 在空行上无意义，忽略

    await db
      .prepare(
        `INSERT INTO session_permission_state
          (session_id, workspace_id, agent_id, accept_edits, global_bypass,
           session_tool_grants_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        workspaceId,
        agentId,
        acceptEdits,
        globalBypass,
        JSON.stringify(grants),
        updatedAt,
      );

    return {
      sessionId,
      workspaceId,
      agentId,
      acceptEdits: acceptEdits === 1,
      globalBypass: globalBypass === 1,
      sessionToolGrants: grants,
      updatedAt,
    };
  });
}

/**
 * Agent 只读：列出 enabled 规则；可选按 toolName 过滤。
 * 表不存在 → 空数组。
 */
export async function listEnabledRulesReadonly(
  workspaceId: string,
  agentId: AgentId,
  toolName?: string,
  options?: { readonly dbPath?: string },
): Promise<readonly ToolTrustRule[]> {
  if (!workspaceId?.trim() || !isAgentId(agentId)) return [];
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();
  try {
    return await withReadableDb(dbPath, async (db) => {
      if (toolName) {
        const rows = (await db
          .prepare(
            `SELECT id, workspace_id, agent_id, tool_name, match_type, pattern,
                    logical_cwd, enabled, created_at
             FROM tool_trust_rules
             WHERE workspace_id = ? AND agent_id = ? AND tool_name = ? AND enabled = 1
             ORDER BY created_at ASC`,
          )
          .all(workspaceId, agentId, toolName)) as RuleRow[];
        return rows.map(rowToRule);
      }
      const rows = (await db
        .prepare(
          `SELECT id, workspace_id, agent_id, tool_name, match_type, pattern,
                  logical_cwd, enabled, created_at
           FROM tool_trust_rules
           WHERE workspace_id = ? AND agent_id = ? AND enabled = 1
           ORDER BY created_at ASC`,
        )
        .all(workspaceId, agentId)) as RuleRow[];
      return rows.map(rowToRule);
    });
  } catch (err) {
    if (err instanceof WorkspaceStoreError && err.code === "database_error") {
      if (/尚不存在/.test(err.message) || isMissingTableError(err)) return [];
    }
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

/** Next 管理页：当前 workspace+agent 全部规则（含 disabled）。 */
export async function listToolTrustRules(
  workspaceId: string,
  agentId: AgentId,
  options?: { readonly dbPath?: string },
): Promise<readonly ToolTrustRule[]> {
  if (!workspaceId?.trim()) {
    throw new ToolTrustStoreError("triple_mismatch", "workspaceId 不能为空。");
  }
  if (!isAgentId(agentId)) {
    throw new ToolTrustStoreError(
      "invalid_agent",
      `无效的 agentId：${String(agentId)}`,
    );
  }
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();
  return withWritableDb(dbPath, async (db) => {
    const rows = (await db
      .prepare(
        `SELECT id, workspace_id, agent_id, tool_name, match_type, pattern,
                logical_cwd, enabled, created_at
         FROM tool_trust_rules
         WHERE workspace_id = ? AND agent_id = ?
         ORDER BY created_at DESC`,
      )
      .all(workspaceId, agentId)) as RuleRow[];
    return rows.map(rowToRule);
  });
}

export type CreateToolTrustRuleInput = {
  readonly workspaceId: string;
  readonly agentId: AgentId;
  readonly toolName: unknown;
  readonly pattern: unknown;
  readonly logicalCwd?: unknown;
  readonly matchType?: unknown;
};

/** 递增 workspace+agent 规则世代；无行则插入 epoch=1。 */
async function bumpRulesEpoch(
  db: Database,
  workspaceId: string,
  agentId: string,
): Promise<number> {
  await db
    .prepare(
      `INSERT INTO tool_trust_rules_epoch (workspace_id, agent_id, epoch)
       VALUES (?, ?, 1)
       ON CONFLICT(workspace_id, agent_id) DO UPDATE SET epoch = epoch + 1`,
    )
    .run(workspaceId, agentId);
  const row = (await db
    .prepare(
      `SELECT epoch FROM tool_trust_rules_epoch
       WHERE workspace_id = ? AND agent_id = ?`,
    )
    .get(workspaceId, agentId)) as { epoch: number } | undefined;
  return row?.epoch ?? 1;
}

/**
 * Agent 只读：当前规则世代。无行 → 0（热缓存仅当 epoch 与固化时一致或更新可见时保留）。
 */
export async function getToolTrustRulesEpochReadonly(
  workspaceId: string,
  agentId: AgentId,
  options?: { readonly dbPath?: string },
): Promise<number> {
  if (!workspaceId?.trim() || !isAgentId(agentId)) return 0;
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();
  try {
    return await withReadableDb(dbPath, async (db) => {
      const row = (await db
        .prepare(
          `SELECT epoch FROM tool_trust_rules_epoch
           WHERE workspace_id = ? AND agent_id = ?`,
        )
        .get(workspaceId, agentId)) as { epoch: number } | undefined;
      return typeof row?.epoch === "number" ? row.epoch : 0;
    });
  } catch (err) {
    if (err instanceof WorkspaceStoreError && err.code === "database_error") {
      if (/尚不存在/.test(err.message) || isMissingTableError(err)) return 0;
    }
    if (isMissingTableError(err)) return 0;
    throw err;
  }
}

/**
 * Agent 只读：按 id 取规则（含 disabled）。无行 → null。
 */
export async function getToolTrustRuleByIdReadonly(
  id: string,
  options?: { readonly dbPath?: string },
): Promise<ToolTrustRule | null> {
  const ruleId = id?.trim();
  if (!ruleId) return null;
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();
  try {
    return await withReadableDb(dbPath, async (db) => {
      const row = (await db
        .prepare(
          `SELECT id, workspace_id, agent_id, tool_name, match_type, pattern,
                  logical_cwd, enabled, created_at
           FROM tool_trust_rules WHERE id = ?`,
        )
        .get(ruleId)) as RuleRow | undefined;
      return row ? rowToRule(row) : null;
    });
  } catch (err) {
    if (err instanceof WorkspaceStoreError && err.code === "database_error") {
      if (/尚不存在/.test(err.message) || isMissingTableError(err)) return null;
    }
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

/**
 * 幂等创建/固化：同内容键只保留一条 enabled 规则。
 * 1) 已有同内容行（任意历史 id）→ 启用之并 bump epoch；
 * 2) 否则用内容哈希 id INSERT；ON CONFLICT(id) 再启用。
 */
export async function createToolTrustRule(
  input: CreateToolTrustRuleInput,
  options?: { readonly dbPath?: string },
): Promise<CreateToolTrustRuleResult> {
  if (!input.workspaceId?.trim()) {
    throw new ToolTrustStoreError("triple_mismatch", "workspaceId 不能为空。");
  }
  if (!isAgentId(input.agentId)) {
    throw new ToolTrustStoreError(
      "invalid_agent",
      `无效的 agentId：${String(input.agentId)}`,
    );
  }
  const validated = validateTrustRuleInput(input);
  const workspaceId = input.workspaceId.trim();
  const contentId = buildToolTrustRuleContentId({
    workspaceId,
    agentId: input.agentId,
    toolName: validated.toolName,
    pattern: validated.pattern,
    logicalCwd: validated.logicalCwd,
  });
  const createdAt = new Date().toISOString();
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();
  const cwdKey = validated.logicalCwd ?? "";

  return withWritableDb(dbPath, async (db) => {
    // 内容唯一：优先复用已有行（兼容历史随机 id）
    const existing = (await db
      .prepare(
        `SELECT id, workspace_id, agent_id, tool_name, match_type, pattern,
                logical_cwd, enabled, created_at
         FROM tool_trust_rules
         WHERE workspace_id = ?
           AND agent_id = ?
           AND tool_name = ?
           AND match_type = 'exact'
           AND pattern = ?
           AND ifnull(logical_cwd, '') = ?
         LIMIT 1`,
      )
      .get(
        workspaceId,
        input.agentId,
        validated.toolName,
        validated.pattern,
        cwdKey,
      )) as RuleRow | undefined;

    if (existing) {
      await db
        .prepare(`UPDATE tool_trust_rules SET enabled = 1 WHERE id = ?`)
        .run(existing.id);
      const rulesEpoch = await bumpRulesEpoch(db, workspaceId, input.agentId);
      return {
        rule: rowToRule({ ...existing, enabled: 1 }),
        rulesEpoch,
      };
    }

    await db
      .prepare(
        `INSERT INTO tool_trust_rules
          (id, workspace_id, agent_id, tool_name, match_type, pattern, logical_cwd, enabled, created_at)
         VALUES (?, ?, ?, ?, 'exact', ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET enabled = 1`,
      )
      .run(
        contentId,
        workspaceId,
        input.agentId,
        validated.toolName,
        validated.pattern,
        validated.logicalCwd,
        createdAt,
      );

    const row = (await db
      .prepare(
        `SELECT id, workspace_id, agent_id, tool_name, match_type, pattern,
                logical_cwd, enabled, created_at
         FROM tool_trust_rules WHERE id = ?`,
      )
      .get(contentId)) as RuleRow | undefined;

    const rulesEpoch = await bumpRulesEpoch(db, workspaceId, input.agentId);
    if (row) {
      return { rule: rowToRule(row), rulesEpoch };
    }
    return {
      rule: {
        id: contentId,
        workspaceId,
        agentId: input.agentId,
        toolName: validated.toolName,
        matchType: "exact",
        pattern: validated.pattern,
        logicalCwd: validated.logicalCwd,
        enabled: true,
        createdAt,
      },
      rulesEpoch,
    };
  });
}

/**
 * 启停规则；校验归属 workspace+agent；变更后 bump epoch。
 */
export async function setToolTrustRuleEnabled(
  input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly agentId: AgentId;
    readonly enabled: boolean;
  },
  options?: { readonly dbPath?: string },
): Promise<ToolTrustRule> {
  const id = input.id?.trim();
  if (!id) {
    throw new ToolTrustStoreError("not_found", "规则 id 不能为空。");
  }
  if (!input.workspaceId?.trim() || !isAgentId(input.agentId)) {
    throw new ToolTrustStoreError("triple_mismatch", "workspace/agent 无效。");
  }
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();
  return withWritableDb(dbPath, async (db) => {
    const row = (await db
      .prepare(
        `SELECT id, workspace_id, agent_id, tool_name, match_type, pattern,
                logical_cwd, enabled, created_at
         FROM tool_trust_rules WHERE id = ?`,
      )
      .get(id)) as RuleRow | undefined;
    if (!row) {
      throw new ToolTrustStoreError("not_found", "规则不存在。");
    }
    if (
      row.workspace_id !== input.workspaceId ||
      row.agent_id !== input.agentId
    ) {
      throw new ToolTrustStoreError(
        "triple_mismatch",
        "规则不属于当前 workspace/agent。",
      );
    }
    await db
      .prepare(`UPDATE tool_trust_rules SET enabled = ? WHERE id = ?`)
      .run(input.enabled ? 1 : 0, id);
    await bumpRulesEpoch(db, input.workspaceId.trim(), input.agentId);
    return rowToRule({ ...row, enabled: input.enabled ? 1 : 0 });
  });
}

export async function deleteToolTrustRule(
  input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly agentId: AgentId;
  },
  options?: { readonly dbPath?: string },
): Promise<void> {
  const id = input.id?.trim();
  if (!id) {
    throw new ToolTrustStoreError("not_found", "规则 id 不能为空。");
  }
  if (!input.workspaceId?.trim() || !isAgentId(input.agentId)) {
    throw new ToolTrustStoreError("triple_mismatch", "workspace/agent 无效。");
  }
  const dbPath = options?.dbPath ?? defaultWorkspaceDbPath();
  await withWritableDb(dbPath, async (db) => {
    const row = (await db
      .prepare(
        `SELECT id, workspace_id, agent_id FROM tool_trust_rules WHERE id = ?`,
      )
      .get(id)) as
      | { id: string; workspace_id: string; agent_id: string }
      | undefined;
    if (!row) {
      throw new ToolTrustStoreError("not_found", "规则不存在。");
    }
    if (
      row.workspace_id !== input.workspaceId ||
      row.agent_id !== input.agentId
    ) {
      throw new ToolTrustStoreError(
        "triple_mismatch",
        "规则不属于当前 workspace/agent。",
      );
    }
    await db.prepare(`DELETE FROM tool_trust_rules WHERE id = ?`).run(id);
    await bumpRulesEpoch(db, input.workspaceId.trim(), input.agentId);
  });
}
