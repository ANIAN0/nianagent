import type {
  MaterialReference,
  WorkspaceRecord,
} from "@/contracts/rpc.generated"

export type RemoteConnectionInfo = {
  server: string
  key: string
  gateway: string
}

export type RemoteEntryPort = {
  readConnection: (value: string) => RemoteConnectionInfo
  connectRemote: (
    info: RemoteConnectionInfo,
    status: (ready: boolean, issue: string) => void
  ) => Promise<() => void>
}

export type RemoteDirectoryPort = {
  chooseRemoteDirectory: (
    add: (path: string, signal?: AbortSignal) => Promise<WorkspaceRecord>,
    signal?: AbortSignal
  ) => Promise<WorkspaceRecord | null>
}

export type RemoteUploadPort = {
  uploadRemoteFile: (
    sessionId: string,
    cwd: string,
    file: File,
    signal: AbortSignal
  ) => Promise<MaterialReference>
  discardRemoteFile: (materialId: string) => Promise<void>
  chooseRemoteFiles: (
    sessionId: string,
    cwd: string,
    signal?: AbortSignal
  ) => Promise<MaterialReference[]>
}

let entryPort: RemoteEntryPort | null = null
let directoryPort: RemoteDirectoryPort | null = null
let uploadPort: RemoteUploadPort | null = null

export function registerRemoteEntryPort(port: RemoteEntryPort) {
  entryPort = port
}

export function registerRemoteDirectoryPort(port: RemoteDirectoryPort) {
  directoryPort = port
}

export function registerRemoteUploadPort(port: RemoteUploadPort) {
  uploadPort = port
}

function requirePort<T>(port: T | null, capability: string): T {
  if (!port) {
    throw new Error(`远程访问能力（${capability}）尚未初始化。`)
  }
  return port
}

export function readRemoteConnection(value: string): RemoteConnectionInfo {
  return requirePort(entryPort, "连接解析").readConnection(value)
}

export function connectRemoteHost(
  info: RemoteConnectionInfo,
  status: (ready: boolean, issue: string) => void
): Promise<() => void> {
  return requirePort(entryPort, "远程连接").connectRemote(info, status)
}

export function chooseRemoteDirectory(
  add: (path: string, signal?: AbortSignal) => Promise<WorkspaceRecord>,
  signal?: AbortSignal
): Promise<WorkspaceRecord | null> {
  return requirePort(directoryPort, "目录选择").chooseRemoteDirectory(
    add,
    signal
  )
}

export function uploadRemoteFile(
  sessionId: string,
  cwd: string,
  file: File,
  signal: AbortSignal
): Promise<MaterialReference> {
  return requirePort(uploadPort, "文件上传").uploadRemoteFile(
    sessionId,
    cwd,
    file,
    signal
  )
}

export function discardRemoteFile(materialId: string): Promise<void> {
  return requirePort(uploadPort, "取消上传").discardRemoteFile(materialId)
}

export function chooseRemoteFiles(
  sessionId: string,
  cwd: string,
  signal?: AbortSignal
): Promise<MaterialReference[]> {
  return requirePort(uploadPort, "文件选择").chooseRemoteFiles(
    sessionId,
    cwd,
    signal
  )
}
