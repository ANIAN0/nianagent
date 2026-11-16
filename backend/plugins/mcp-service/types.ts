export type SharedToolDescriptor = {
  name: string
  plugin: string
  generation: number
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, boolean>
}
export type McpServiceIdentity = {
  actors: number
  credentials: number
  valid: number
}
export type McpServiceStatus = {
  running: boolean
  url: string
  port: number
  revision: number
  selected: string[]
  tools: SharedToolDescriptor[]
  issue: string
  logIssue: string
  identity: McpServiceIdentity
  protocol: string
}
export type RegisteredCredential = {
  actorId: string
  displayName: string
  kind: string
  credentialId: string
  createdAt: string
  revokedAt: string
  valid: boolean
}
export type RegistrationResult = {
  actorId: string
  displayName: string
  credentialId: string
  token: string
  revision: number
}
export type McpServiceClient = {
  read(signal?: AbortSignal): Promise<McpServiceStatus>
  save(
    input: { revision: number; port: number; selected: string[] },
    signal?: AbortSignal
  ): Promise<McpServiceStatus>
  reveal(signal?: AbortSignal): Promise<{ token: string }>
  reset(revision: number, signal?: AbortSignal): Promise<McpServiceStatus>
  register(
    input: { displayName: string },
    signal?: AbortSignal
  ): Promise<RegistrationResult>
  rotate(
    input: { actorId: string },
    signal?: AbortSignal
  ): Promise<RegistrationResult>
  revoke(
    input: { credentialId: string },
    signal?: AbortSignal
  ): Promise<McpServiceStatus>
  credentials(signal?: AbortSignal): Promise<{
    credentials: RegisteredCredential[]
  }>
}
