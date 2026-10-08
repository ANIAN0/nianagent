export type ServiceRoot = "models" | "jobs" | "sessions" | "conversations" | "conversationCatalog" | "workspaces" | "materials" | "mcp" | "extensions" | "writeReceipt"
export type ReadyDependency = "models" | "extensions" | "conversations"
export const serviceRegistry: Record<ServiceRoot, {ready: ReadyDependency[]; source: string; storage: string}>
export function serviceRoot(method: string): ServiceRoot
export function operationDependencies(method: string): ReadyDependency[]
