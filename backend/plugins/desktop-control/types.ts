export type DesktopControlAction = "install" | "upgrade" | "uninstall"

export type DesktopControlOperation = {
  id: string
  action: DesktopControlAction
  state: "running" | "succeeded" | "failed" | "unknown"
  phase: string
  startedAt: string
  endedAt: string | null
  beforeVersion: string | null
  targetVersion: string | null
  error: string
}

export type PermissionEntry = {
  state: "granted" | "denied" | "not_required" | "unknown"
  suggestion?: string
}

export type PermissionsReport = {
  accessibility: PermissionEntry
  screen_recording: PermissionEntry
  automation: PermissionEntry
}

export type DesktopControlStatus = {
  installation: {
    state: "installed" | "not-installed" | "unavailable"
    source: "npm" | "path" | null
    version: string | null
    path: string | null
    cliPath: string | null
    license: string | null
    npmPath: string | null
    nodePath: string | null
    usable: boolean
    launcherFallback: boolean
    issue: string
    latestVersion: string | null
    latestIssue: string
  }
  environment: {
    platform: string
    ok: boolean
    supportedSurfaces: string[]
    permissions: PermissionsReport | null
    stateRoot: string
    issue: string
  }
  sessions: {
    activeCount: number
    endedCount: number
    latestSessionId: string | null
    latestTraceAvailable: boolean
  }
  operation: DesktopControlOperation | null
  issue: string
}

export type ProbeWindowsResult = {
  ok: boolean
  windowCount: number
  appCount: number
  checkedAt: string
  issue: string
}

export type ExportTraceResult = {
  sessionId: string
  path: string
}

export type GcSessionsResult = {
  removedCount: number
}

export type DesktopControlService = {
  read: (signal?: AbortSignal) => Promise<DesktopControlStatus>
  manage: (
    action: DesktopControlAction
  ) => Promise<{ operation: DesktopControlOperation }>
  probeWindows: () => Promise<ProbeWindowsResult>
  requestPermissions: () => Promise<PermissionsReport>
  guidePermissions: () => Promise<PermissionsReport>
  exportTrace: (sessionId?: string) => Promise<ExportTraceResult>
  gcSessions: () => Promise<GcSessionsResult>
}
