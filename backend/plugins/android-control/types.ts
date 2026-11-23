export type AndroidControlAction = "install" | "upgrade" | "uninstall"

export type AndroidControlOperation = {
  id: string
  action: AndroidControlAction
  state: "running" | "succeeded" | "failed" | "cancelled" | "unknown"
  phase: string
  startedAt: string
  endedAt: string | null
  beforeVersion: string | null
  targetVersion: string | null
  error: string
  logs?: string[]
}

export type AndroidDevice = {
  serial: string
  state: "device" | "unauthorized" | "offline" | "unknown"
  transport: "usb" | "tcpip"
  model: string
  androidVersion: string
  isDefault: boolean
  mirroring: boolean
  mirrorPid: number | null
  issue: string
}

export type AndroidInstallation = {
  state: "ready" | "partial" | "not-installed" | "unavailable"
  source: "custom" | "path" | "package-manager" | null
  packageManager: "winget" | "scoop" | "choco" | "brew" | null
  scrcpyVersion: string | null
  adbVersion: string | null
  scrcpyPath: string | null
  adbPath: string | null
  serverPath: string | null
  usable: boolean
  canMirror: boolean
  issue: string
}

export type AndroidControlStatus = {
  installation: AndroidInstallation
  devices: AndroidDevice[]
  defaultSerial: string
  operation: AndroidControlOperation | null
  issue: string
}

export type ProbeDeviceResult = {
  ok: boolean
  serial: string
  model: string
  resolution: string
  uiNodeCount: number
  checkedAt: string
  issue: string
}

export type AndroidControlService = {
  read: (signal?: AbortSignal) => Promise<AndroidControlStatus>
  manage: (
    action: AndroidControlAction
  ) => Promise<{ operation: AndroidControlOperation }>
  cancelManage: () => Promise<{
    cancelled: boolean
    operation: AndroidControlOperation | null
  }>
  refreshDevices: () => Promise<{ devices: AndroidDevice[] }>
  connectWireless: (
    address: string
  ) => Promise<{ ok: boolean; serial: string; message: string }>
  pairWireless: (
    address: string,
    pairingCode: string
  ) => Promise<{ ok: boolean; message: string }>
  enableTcpip: (
    serial: string,
    port?: number
  ) => Promise<{ ok: boolean; address: string }>
  disconnectWireless: (serial: string) => Promise<{ ok: boolean }>
  startMirror: (input?: {
    serial?: string
    virtualDisplay?: string
    startApp?: string
  }) => Promise<{ serial: string; pid: number; mode: string }>
  stopMirror: (serial: string) => Promise<{ ok: boolean }>
  probeDevice: (serial?: string) => Promise<ProbeDeviceResult>
}
