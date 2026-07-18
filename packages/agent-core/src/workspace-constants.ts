/** 浏览器 → Eve 的 capability 请求头（纯常量，可被客户端安全导入）。 */
export const WORKSPACE_CAPABILITY_HEADER = "x-nianagent-workspace-capability";

/** initiator / current auth.attributes 中的 workspaceId 键。 */
export const WORKSPACE_ID_ATTR = "workspaceId";

/** 会话模式意图头：0|1；首 turn 无 session 行时写入 initiator auth 引导。 */
export const SESSION_ACCEPT_EDITS_HEADER = "x-nian-session-accept-edits";
export const SESSION_GLOBAL_BYPASS_HEADER = "x-nian-session-global-bypass";

/**
 * 信任扩大授权意图头：session_tool | persistent。
 * 仅本次不发送或发 none；与 approve 的 inputResponses 同请求。
 */
export const TRUST_SCOPE_HEADER = "x-nian-trust-scope";

/**
 * 信任意图关联的工具 callId（与 Eve ToolContext.callId / 流事件 toolCallId 对齐）。
 * 因审批 requestId（approvalId）可能 ≠ callId，execute 屏障用此键精确 take。
 */
export const TRUST_CALL_ID_HEADER = "x-nian-trust-call-id";

/** initiator auth.attributes：会话模式引导位（字符串 "0"|"1"）。 */
export const AUTH_ATTR_ACCEPT_EDITS = "nian.acceptEdits";
export const AUTH_ATTR_GLOBAL_BYPASS = "nian.globalBypass";

/** Agent → Next 固化默认基址（可用 NIANAGENT_NEXT_BASE_URL 覆盖）。 */
export const DEFAULT_NEXT_BASE_URL = "http://127.0.0.1:3000";
