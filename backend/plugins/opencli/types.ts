export type OpenCliAction =
  "install" | "uninstall" | "upgrade" | "start" | "stop"
export type OpenCliInput = {
  expectedDaemonPid?: number
  expectedDaemonVersion?: string
}
export type OpenCliOperation = {
  id: string
  action: OpenCliAction
  state: "running" | "succeeded" | "failed" | "unknown"
  phase: string
  startedAt: string
  endedAt: string | null
  beforeVersion: string | null
  targetVersion: string | null
  error: string
}
export type OpenCliStatus = {
  installation: {
    state: "installed" | "not-installed" | "unavailable"
    version: string | null
    path: string | null
    cliPath: string | null
    daemonPath: string | null
    license: string | null
    npmPath: string | null
    nodePath: string | null
    usable: boolean
    issue: string
    latestVersion: string | null
    latestIssue: string
  }
  daemon: {
    state: "running" | "stopped" | "unknown"
    pid: number | null
    version: string | null
    owned: boolean
  }
  bridge: {
    connected: boolean
    profileRequired: boolean
    profiles: {
      contextId: string
      extensionVersion?: string
      aliases?: string[]
    }[]
  }
  operation: OpenCliOperation | null
  browserSupport: { supported: boolean; issue: string } | null
  version: string | null
  status: object | null
  issue: string
}
export type OpenCliTarget = {
  bound: { title: string; url: string; targetId: string; issue?: string } | null
  session: string
}
export type OpenCliService = {
  read: (signal?: AbortSignal) => Promise<OpenCliStatus>
  manage: (
    action: OpenCliAction,
    input: OpenCliInput
  ) => Promise<{ operation: OpenCliOperation }>
}
