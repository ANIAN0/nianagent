/**
 * 事件类型判定（对齐 @workflow/world events.ts）。
 * 不引入 workspace 包，避免 Next 客户端依赖 Eve 服务端模块。
 */

const STEP_EVENT_TYPES = new Set([
  "step_created",
  "step_completed",
  "step_failed",
  "step_retrying",
  "step_started",
]);

const TERMINAL_STEP_EVENT_TYPES = new Set(["step_completed", "step_failed"]);

const HOOK_LIFECYCLE_EVENT_TYPES = new Set([
  "hook_created",
  "hook_received",
  "hook_disposed",
]);

const WAIT_EVENT_TYPES = new Set(["wait_created", "wait_completed"]);

export function isStepEventType(eventType: string): boolean {
  return STEP_EVENT_TYPES.has(eventType);
}

export function isTerminalStepEventType(eventType: string): boolean {
  return TERMINAL_STEP_EVENT_TYPES.has(eventType);
}

export function isHookLifecycleEventType(eventType: string): boolean {
  return HOOK_LIFECYCLE_EVENT_TYPES.has(eventType);
}

export function isWaitEventType(eventType: string): boolean {
  return WAIT_EVENT_TYPES.has(eventType);
}
