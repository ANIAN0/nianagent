import evePackage from "eve/package.json";

export type ChatAgentId = "knowledge-base" | "work-assistant";

export type StoredBindingRoot = {
  readonly alias: string;
  readonly displayPath: string;
};

export type StoredBinding = {
  readonly workspaceId: string;
  readonly agentId: ChatAgentId;
  readonly roots: readonly StoredBindingRoot[];
};

/**
 * 当前前端/依赖树解析到的 eve 版本。
 * Workflow step 名含 `step//eve@<version>//...`；主版本线变化后旧 cursor 无法 replay。
 */
export const INSTALLED_EVE_VERSION: string = evePackage.version;

/** sessionStorage 中的完整恢复载荷（含 Eve cursor + events + capability）。 */
export type ChatSessionSnapshot = {
  readonly binding: StoredBinding;
  readonly capability: string;
  readonly session: unknown;
  readonly events: readonly unknown[];
  /**
   * 写入时的 eve 包版本。缺失或与 {@link INSTALLED_EVE_VERSION} 不一致时，
   * 丢弃 session/events，保留 binding（升级/重装后旧 durable run 不可恢复）。
   */
  readonly eveVersion?: string;
};

function storageKey(agentId: ChatAgentId): string {
  return `nianagent:chat:${agentId}`;
}

/** 旧 cursor 是否仍可尝试恢复（仅版本字符串一致时）。 */
export function isChatCursorCompatible(
  snapshot: Pick<ChatSessionSnapshot, "eveVersion">,
): boolean {
  return snapshot.eveVersion === INSTALLED_EVE_VERSION;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentId(value: unknown): value is ChatAgentId {
  return value === "knowledge-base" || value === "work-assistant";
}

/**
 * 结构校验；损坏数据返回 null，不抛到调用方未处理异常。
 */
export function parseChatSessionSnapshot(
  raw: unknown,
): ChatSessionSnapshot | null {
  if (!isObject(raw)) return null;
  if (typeof raw.capability !== "string" || raw.capability.length < 8) {
    return null;
  }
  if (!isObject(raw.binding)) return null;
  if (!isAgentId(raw.binding.agentId)) return null;
  if (typeof raw.binding.workspaceId !== "string" || !raw.binding.workspaceId) {
    return null;
  }
  if (!Array.isArray(raw.binding.roots) || raw.binding.roots.length === 0) {
    return null;
  }
  const roots: StoredBindingRoot[] = [];
  for (const r of raw.binding.roots) {
    if (!isObject(r)) return null;
    if (typeof r.alias !== "string" || typeof r.displayPath !== "string") {
      return null;
    }
    roots.push({ alias: r.alias, displayPath: r.displayPath });
  }
  // session / events 允许为 null 初态；有值时须为对象 / 数组
  const session = raw.session;
  const events = raw.events;
  if (session !== null && session !== undefined && !isObject(session)) {
    return null;
  }
  if (events !== undefined && events !== null && !Array.isArray(events)) {
    return null;
  }
  const eveVersion =
    typeof raw.eveVersion === "string" && raw.eveVersion.length > 0
      ? raw.eveVersion
      : undefined;
  return {
    binding: {
      workspaceId: raw.binding.workspaceId,
      agentId: raw.binding.agentId,
      roots,
    },
    capability: raw.capability,
    session: session ?? null,
    events: Array.isArray(events) ? events : [],
    eveVersion,
  };
}

/**
 * 读出快照；若 eve 版本与当前安装不一致，剥离失效 cursor/事件并写回
 *（保留 workspace binding + capability）。
 */
export function loadChatSession(
  agentId: ChatAgentId,
): ChatSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const text = sessionStorage.getItem(storageKey(agentId));
    if (!text) return null;
    const parsed = JSON.parse(text) as unknown;
    const snap = parseChatSessionSnapshot(parsed);
    if (!snap || snap.binding.agentId !== agentId) {
      sessionStorage.removeItem(storageKey(agentId));
      return null;
    }
    if (isChatCursorCompatible(snap)) {
      return snap;
    }
    // 升级前后 step//eve@x.y.z 不一致 → ReplayDivergenceError；勿恢复旧 cursor
    const migrated: ChatSessionSnapshot = {
      binding: snap.binding,
      capability: snap.capability,
      session: null,
      events: [],
      eveVersion: INSTALLED_EVE_VERSION,
    };
    sessionStorage.setItem(storageKey(agentId), JSON.stringify(migrated));
    return migrated;
  } catch {
    try {
      sessionStorage.removeItem(storageKey(agentId));
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function saveChatSession(
  agentId: ChatAgentId,
  snapshot: ChatSessionSnapshot,
): void {
  if (typeof window === "undefined") return;
  try {
    if (snapshot.binding.agentId !== agentId) return;
    const withVersion: ChatSessionSnapshot = {
      ...snapshot,
      eveVersion: snapshot.eveVersion ?? INSTALLED_EVE_VERSION,
    };
    sessionStorage.setItem(storageKey(agentId), JSON.stringify(withVersion));
  } catch {
    // quota / private mode：忽略，不影响当前会话
  }
}

export function clearChatSession(agentId: ChatAgentId): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(storageKey(agentId));
  } catch {
    /* ignore */
  }
}
