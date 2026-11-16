export type ServiceRoot = "boot" | "models" | "jobs" | "sessions" | "conversations" | "conversationCatalog" | "workspaces" | "materials" | "mcp" | "extensions" | "writeReceipt" | "writeReceipts" | "plugins"
export type ReadyDependency = "models" | "extensions" | "conversations"
export const serviceRegistry: Record<ServiceRoot, {ready: ReadyDependency[]; source: string; storage: string}>
export function serviceRoot(method: string): ServiceRoot
export function assertRegistryCovers(operations: Record<string, {method: string}>): void
export function receiptRootFor(operation: string, operations: Record<string, {method: string}>): ServiceRoot
export function operationDependencies(method: string): ReadyDependency[]
export function mergeOperationGroups<T>(...groups: Record<string, T>[]): Record<string, T>
