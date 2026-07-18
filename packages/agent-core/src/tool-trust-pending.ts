/**
 * 进程内信任意图 pending + 同 turn 热缓存 + Agent→Next 固化。
 * pending **不得**参与 decide 放行；仅 execute 屏障按 callId 精确 take 后 await Next。
 * Agent 不直写 Turso。
 *
 * 绑定约定（Eve 0.25.1）：
 * - 客户端 inputResponses.requestId = 审批 approvalId（可能 ≠ tool callId）
 * - 客户端同时发 X-Nian-Trust-Call-Id = 动态工具 part.toolCallId / action.callId
 * - execute 侧用 ToolContext.callId 精确取出；禁止 session FIFO 误绑
 */
import type { AgentId } from "./model-catalog";
import {
  DEFAULT_NEXT_BASE_URL,
  TRUST_CALL_ID_HEADER,
  TRUST_SCOPE_HEADER,
  WORKSPACE_CAPABILITY_HEADER,
} from "./workspace-constants";
import {
  isTrustableToolName,
  normalizeCommandExact,
  normalizeTrustLogicalPath,
  validateTrustRuleInput,
  type TrustableToolName,
  type ToolTrustRule,
} from "./tool-trust-store";

export type TrustScope = "session_tool" | "persistent";

export type TrustPendingIntent = {
  readonly scope: TrustScope;
  readonly capability: string;
  readonly agentId: AgentId;
  /** 客户端 inputResponses.requestId（approvalId），供 deny 清理 */
  readonly requestId: string;
  /** Eve tool callId；execute 屏障匹配键 */
  readonly callId: string;
  readonly createdAt: number;
};

/** 孤儿 pending 存活上限（ms）；超时丢弃，避免进程内泄漏 */
const PENDING_TTL_MS = 15 * 60 * 1000;

function sessionGrantKey(
  sessionId: string,
  workspaceId: string,
  agentId: string,
): string {
  return `${sessionId}\0${workspaceId}\0${agentId}`;
}

function ruleCacheKey(workspaceId: string, agentId: string): string {
  return `${workspaceId}\0${agentId}`;
}

function compositeKey(sessionId: string, id: string): string {
  return `${sessionId.trim()}\0${id.trim()}`;
}

/**
 * 主索引：`${sessionId}\0${callId}` → intent（execute take 唯一来源）。
 * 禁止 FIFO。
 */
const pendingByCallId = new Map<string, TrustPendingIntent>();

/**
 * 副索引：`${sessionId}\0${requestId}` → callId（deny / 按审批 id 清理）。
 */
const callIdByRequestId = new Map<string, string>();

/** 热缓存：本进程 execute 刚固化的 session grants（同 turn decide 必查）。 */
const hotSessionGrants = new Map<string, Set<string>>();

/**
 * 热缓存：本进程刚 POST 的规则 + 固化时的 rules epoch。
 * 当库中 epoch 已大于缓存 epoch（禁用/删除/再次固化）时整表失效。
 */
type HotRuleBucket = {
  epoch: number;
  rules: ToolTrustRule[];
};

const hotRules = new Map<string, HotRuleBucket>();

export function isTrustScope(value: unknown): value is TrustScope {
  return value === "session_tool" || value === "persistent";
}

function pruneExpiredPending(now = Date.now()): void {
  for (const [callKey, intent] of [...pendingByCallId.entries()]) {
    if (now - intent.createdAt <= PENDING_TTL_MS) continue;
    pendingByCallId.delete(callKey);
    const sep = callKey.indexOf("\0");
    if (sep >= 0) {
      const sessionId = callKey.slice(0, sep);
      callIdByRequestId.delete(compositeKey(sessionId, intent.requestId));
    }
  }
  // 清掉指向已不存在主索引的副索引
  for (const [reqKey, callId] of [...callIdByRequestId.entries()]) {
    const sep = reqKey.indexOf("\0");
    if (sep < 0) {
      callIdByRequestId.delete(reqKey);
      continue;
    }
    const sessionId = reqKey.slice(0, sep);
    if (!pendingByCallId.has(compositeKey(sessionId, callId))) {
      callIdByRequestId.delete(reqKey);
    }
  }
}

/**
 * 登记信任意图（仅 scope；规则内容由 execute 时 toolInput 生成）。
 * 主键 callId；副键 requestId 供 deny 清理。同 callId 重复登记覆盖。
 */
export function registerTrustPending(
  sessionId: string,
  intent: TrustPendingIntent,
): void {
  const sid = sessionId.trim();
  const callId = intent.callId.trim();
  const requestId = intent.requestId.trim();
  if (!sid || !callId || !requestId) return;
  pruneExpiredPending();

  const callKey = compositeKey(sid, callId);
  // 若同 request 曾指向其它 call，先拆旧主索引
  const prevCall = callIdByRequestId.get(compositeKey(sid, requestId));
  if (prevCall && prevCall !== callId) {
    pendingByCallId.delete(compositeKey(sid, prevCall));
  }

  const normalized: TrustPendingIntent = {
    ...intent,
    callId,
    requestId,
  };
  pendingByCallId.set(callKey, normalized);
  callIdByRequestId.set(compositeKey(sid, requestId), callId);
}

/**
 * execute 屏障：仅取出与当次 callId 精确匹配的 intent。
 * **decide 禁止调用**。无匹配 → null（不得 FIFO 取其它调用）。
 */
export function takeTrustPending(
  sessionId: string,
  callId: string,
): TrustPendingIntent | null {
  const sid = sessionId.trim();
  const cid = callId.trim();
  if (!sid || !cid) return null;
  pruneExpiredPending();
  const callKey = compositeKey(sid, cid);
  const intent = pendingByCallId.get(callKey);
  if (!intent) return null;
  pendingByCallId.delete(callKey);
  callIdByRequestId.delete(compositeKey(sid, intent.requestId));
  return intent;
}

/** 按 requestId 丢弃 pending（deny；不写库）。 */
export function clearTrustPendingByRequestId(
  sessionId: string,
  requestId: string,
): boolean {
  const sid = sessionId.trim();
  const rid = requestId.trim();
  if (!sid || !rid) return false;
  const reqKey = compositeKey(sid, rid);
  const callId = callIdByRequestId.get(reqKey);
  callIdByRequestId.delete(reqKey);
  if (!callId) {
    // 兼容：若曾错误地用 requestId 当 callId 登记
    return pendingByCallId.delete(compositeKey(sid, rid));
  }
  return pendingByCallId.delete(compositeKey(sid, callId));
}

/** 按 callId 丢弃 pending。 */
export function clearTrustPendingByCallId(
  sessionId: string,
  callId: string,
): boolean {
  const sid = sessionId.trim();
  const cid = callId.trim();
  if (!sid || !cid) return false;
  const callKey = compositeKey(sid, cid);
  const intent = pendingByCallId.get(callKey);
  if (!intent) return false;
  pendingByCallId.delete(callKey);
  callIdByRequestId.delete(compositeKey(sid, intent.requestId));
  return true;
}

/** 丢弃某会话全部 pending（不写库）。 */
export function clearTrustPending(sessionId: string): void {
  const sid = sessionId.trim();
  if (!sid) return;
  const prefix = `${sid}\0`;
  for (const key of [...pendingByCallId.keys()]) {
    if (key.startsWith(prefix)) pendingByCallId.delete(key);
  }
  for (const key of [...callIdByRequestId.keys()]) {
    if (key.startsWith(prefix)) callIdByRequestId.delete(key);
  }
}

export function addHotSessionGrant(input: {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly agentId: AgentId;
  readonly toolName: string;
}): void {
  const key = sessionGrantKey(input.sessionId, input.workspaceId, input.agentId);
  let set = hotSessionGrants.get(key);
  if (!set) {
    set = new Set();
    hotSessionGrants.set(key, set);
  }
  set.add(input.toolName);
}

export function hasHotSessionGrant(input: {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly agentId: AgentId;
  readonly toolName: string;
}): boolean {
  const key = sessionGrantKey(input.sessionId, input.workspaceId, input.agentId);
  return hotSessionGrants.get(key)?.has(input.toolName) === true;
}

/**
 * 写入热规则。
 * @param rulesEpoch 固化 API 返回的世代；若低于桶内已有世代则忽略（过期响应）。
 */
export function addHotRule(rule: ToolTrustRule, rulesEpoch: number): void {
  const key = ruleCacheKey(rule.workspaceId, rule.agentId);
  const epoch = Number.isFinite(rulesEpoch) ? Math.max(0, Math.floor(rulesEpoch)) : 0;
  const bucket = hotRules.get(key);
  if (!bucket || epoch > bucket.epoch) {
    hotRules.set(key, { epoch, rules: [{ ...rule, enabled: true }] });
    return;
  }
  if (epoch < bucket.epoch) {
    // 过期响应，不污染更新后的缓存
    return;
  }
  // 同世代：按 id 覆盖/追加
  const without = bucket.rules.filter((r) => r.id !== rule.id);
  hotRules.set(key, {
    epoch: bucket.epoch,
    rules: [...without, { ...rule, enabled: true }],
  });
}

/**
 * 列出热规则。dbEpoch 为当前只读库世代：
 * - 缓存 epoch < dbEpoch → 已有更新的库变更（禁用/删除等），整桶丢弃；
 * - 缓存 epoch >= dbEpoch → 允许（含「刚固化、库世代尚未可见」窗口）。
 */
export function listHotRules(
  workspaceId: string,
  agentId: AgentId,
  toolName: string | undefined,
  dbEpoch: number,
): readonly ToolTrustRule[] {
  const key = ruleCacheKey(workspaceId, agentId);
  const bucket = hotRules.get(key);
  if (!bucket) return [];
  const epoch = Number.isFinite(dbEpoch) ? Math.floor(dbEpoch) : 0;
  if (bucket.epoch < epoch) {
    hotRules.delete(key);
    return [];
  }
  const list = bucket.rules.filter((r) => r.enabled);
  if (!toolName) return list;
  return list.filter((r) => r.toolName === toolName);
}

/** 按 id 移除热规则（DB 复核发现已禁用/删除时）。 */
export function removeHotRule(
  workspaceId: string,
  agentId: AgentId,
  ruleId: string,
): void {
  const key = ruleCacheKey(workspaceId, agentId);
  const bucket = hotRules.get(key);
  if (!bucket) return;
  const next = bucket.rules.filter((r) => r.id !== ruleId);
  if (next.length === 0) {
    hotRules.delete(key);
    return;
  }
  hotRules.set(key, { epoch: bucket.epoch, rules: next });
}

/**
 * 从 Request 克隆体解析 inputResponses：
 * - approve + 信任头 + callId → 按 callId 登记 pending
 * - deny（无论是否带头）→ 清除对应 requestId/callId 的 pending
 * body 可被 Eve 再读。
 */
export async function tryRegisterTrustPendingFromRequest(input: {
  readonly request: Request;
  readonly agentId: AgentId;
  readonly sessionId: string | undefined;
}): Promise<void> {
  const sessionId = input.sessionId?.trim();
  if (!sessionId) return;

  let body: unknown;
  try {
    body = await input.request.clone().json();
  } catch {
    return;
  }
  if (!body || typeof body !== "object") return;
  const responses = (body as { inputResponses?: unknown }).inputResponses;
  if (!Array.isArray(responses) || responses.length === 0) return;

  const scopeRaw = input.request.headers.get(TRUST_SCOPE_HEADER)?.trim() ?? "";
  const scope = isTrustScope(scopeRaw) ? scopeRaw : null;
  const capability =
    input.request.headers.get(WORKSPACE_CAPABILITY_HEADER)?.trim() ?? "";
  // 单卡提交时一个 callId；与当次 inputResponses 对齐
  const headerCallId =
    input.request.headers.get(TRUST_CALL_ID_HEADER)?.trim() ?? "";

  const now = Date.now();
  pruneExpiredPending(now);

  for (const item of responses) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { optionId?: unknown; requestId?: unknown };
    if (typeof rec.requestId !== "string" || !rec.requestId.trim()) continue;
    const requestId = rec.requestId.trim();

    if (rec.optionId === "deny") {
      clearTrustPendingByRequestId(sessionId, requestId);
      if (headerCallId) clearTrustPendingByCallId(sessionId, headerCallId);
      continue;
    }

    if (rec.optionId !== "approve") continue;

    if (!scope || !capability) {
      // 仅本次：清残留扩大授权意图
      clearTrustPendingByRequestId(sessionId, requestId);
      if (headerCallId) clearTrustPendingByCallId(sessionId, headerCallId);
      continue;
    }

    // 扩大授权：必须有 callId 才能在 execute 精确匹配。
    // 优先请求头；若缺省且历史路径 requestId===callId 仍可工作。
    const callId = headerCallId || requestId;
    registerTrustPending(sessionId, {
      scope,
      capability,
      agentId: input.agentId,
      requestId,
      callId,
      createdAt: now,
    });
  }
}

export function resolveNextBaseUrl(): string {
  const fromEnv =
    process.env.NIANAGENT_NEXT_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return DEFAULT_NEXT_BASE_URL;
}

function bareToolName(toolName: string): string {
  const raw = toolName.trim();
  const slash = raw.lastIndexOf("/");
  const name = slash >= 0 ? raw.slice(slash + 1) : raw;
  const dunder = name.lastIndexOf("__");
  return dunder >= 0 ? name.slice(dunder + 2) : name;
}

/**
 * 从当次 toolInput 构建持久规则字段；过宽则抛错（屏障捕获后不写库）。
 */
export function buildRuleFieldsFromToolInput(
  toolName: string,
  toolInput: unknown,
): {
  toolName: TrustableToolName;
  pattern: string;
  logicalCwd: string | null;
  matchType: "exact";
} {
  const bare = bareToolName(toolName);
  if (!isTrustableToolName(bare)) {
    throw new Error(`不可信任的工具名：${bare}`);
  }
  const input =
    toolInput && typeof toolInput === "object"
      ? (toolInput as Record<string, unknown>)
      : {};

  if (bare === "powershell") {
    return validateTrustRuleInput({
      toolName: bare,
      pattern: typeof input.command === "string" ? input.command : "",
      logicalCwd: typeof input.cwd === "string" ? input.cwd : "",
      matchType: "exact",
    });
  }

  const filePath =
    typeof input.filePath === "string"
      ? input.filePath
      : typeof input.path === "string"
        ? input.path
        : "";
  return validateTrustRuleInput({
    toolName: bare,
    pattern: filePath,
    matchType: "exact",
  });
}

/** exact 匹配：PS = cwd+command；文件 = 逻辑路径。 */
export function ruleMatchesToolInput(
  rule: ToolTrustRule,
  toolInput: unknown,
): boolean {
  if (!rule.enabled || rule.matchType !== "exact") return false;
  const input =
    toolInput && typeof toolInput === "object"
      ? (toolInput as Record<string, unknown>)
      : {};

  if (rule.toolName === "powershell") {
    if (typeof input.command !== "string" || typeof input.cwd !== "string") {
      return false;
    }
    if (normalizeCommandExact(input.command) !== rule.pattern) return false;
    try {
      return normalizeTrustLogicalPath(input.cwd) === rule.logicalCwd;
    } catch {
      return false;
    }
  }

  const filePath =
    typeof input.filePath === "string"
      ? input.filePath
      : typeof input.path === "string"
        ? input.path
        : "";
  if (!filePath) return false;
  try {
    return normalizeTrustLogicalPath(filePath) === rule.pattern;
  } catch {
    return false;
  }
}

/**
 * execute 入口屏障：按 callId 精确 take pending → await Next → 热缓存。
 * 无匹配 intent → 不写库；失败不阻断已批准执行。
 */
export async function commitTrustBeforeExecute(input: {
  readonly sessionId: string;
  readonly agentId: AgentId;
  readonly workspaceId: string;
  readonly toolName: string;
  readonly toolInput: unknown;
  /** Eve ToolContext.callId */
  readonly callId: string;
}): Promise<{ readonly committed: boolean; readonly failed?: string }> {
  const callId = input.callId?.trim() ?? "";
  if (!callId) {
    return { committed: false, failed: "missing_call_id" };
  }

  const intent = takeTrustPending(input.sessionId, callId);
  if (!intent) {
    return { committed: false };
  }
  if (intent.agentId !== input.agentId) {
    return { committed: false, failed: "agent_mismatch" };
  }

  const bare = bareToolName(input.toolName);
  const base = resolveNextBaseUrl();

  try {
    if (intent.scope === "session_tool") {
      if (!isTrustableToolName(bare)) {
        return { committed: false, failed: "invalid_tool" };
      }
      const res = await fetch(`${base}/api/session-permissions`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capability: intent.capability,
          agentId: input.agentId,
          sessionId: input.sessionId,
          grantTool: bare,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(
          `[trust_commit_failed] grantTool HTTP ${res.status}: ${text}`,
        );
        return { committed: false, failed: `http_${res.status}` };
      }
      addHotSessionGrant({
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        toolName: bare,
      });
      return { committed: true };
    }

    let fields: ReturnType<typeof buildRuleFieldsFromToolInput>;
    try {
      fields = buildRuleFieldsFromToolInput(input.toolName, input.toolInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[trust_commit_failed] overbroad/invalid rule: ${message}`);
      return { committed: false, failed: "overbroad_rule" };
    }

    const res = await fetch(`${base}/api/tool-trust-rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capability: intent.capability,
        agentId: input.agentId,
        toolName: fields.toolName,
        pattern: fields.pattern,
        logicalCwd: fields.logicalCwd ?? undefined,
        matchType: "exact",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[trust_commit_failed] postRule HTTP ${res.status}: ${text}`,
      );
      return { committed: false, failed: `http_${res.status}` };
    }
    let rule: ToolTrustRule | null = null;
    let rulesEpoch = 0;
    try {
      const json = (await res.json()) as {
        rule?: ToolTrustRule;
        rulesEpoch?: number;
      };
      if (json.rule) rule = json.rule;
      if (typeof json.rulesEpoch === "number" && Number.isFinite(json.rulesEpoch)) {
        rulesEpoch = Math.floor(json.rulesEpoch);
      }
    } catch {
      // 无 body 仍视为成功写库；热缓存用本地字段
    }
    const cached: ToolTrustRule = rule ?? {
      id: `hot-${Date.now()}`,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      toolName: fields.toolName,
      matchType: "exact",
      pattern: fields.pattern,
      logicalCwd: fields.logicalCwd,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    // 无 epoch 时用 0：一旦库出现更大世代（含首次禁用）即失效
    addHotRule(cached, rulesEpoch);
    return { committed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[trust_commit_failed] ${message}`);
    return { committed: false, failed: message };
  }
}

/** 测试钩子：清空进程内 pending 与热缓存。 */
export function resetTrustPendingForTests(): void {
  pendingByCallId.clear();
  callIdByRequestId.clear();
  hotSessionGrants.clear();
  hotRules.clear();
}

export { bareToolName };
