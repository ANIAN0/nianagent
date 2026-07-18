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

/** sessionStorage 中的完整恢复载荷（含 Eve cursor + events + capability）。 */
export type ChatSessionSnapshot = {
  readonly binding: StoredBinding;
  readonly capability: string;
  readonly session: unknown;
  readonly events: readonly unknown[];
};

function storageKey(agentId: ChatAgentId): string {
  return `nianagent:chat:${agentId}`;
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
  return {
    binding: {
      workspaceId: raw.binding.workspaceId,
      agentId: raw.binding.agentId,
      roots,
    },
    capability: raw.capability,
    session: session ?? null,
    events: Array.isArray(events) ? events : [],
  };
}

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
    return snap;
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
    sessionStorage.setItem(storageKey(agentId), JSON.stringify(snapshot));
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
