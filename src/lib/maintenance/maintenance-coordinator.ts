import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react"
import type { Activity } from "@/contracts/desktop.generated"
import type { ModelOperation } from "@/contracts/rpc.generated"

type SaveParticipant = () => void | Activity[] | Promise<void | Activity[]>
const participants = new Map<symbol, SaveParticipant>()
const listeners = new Set<() => void>()
let frozen = false

/** 宿主状态是唯一门禁来源；同步 ref 同时保护 React 尚未重绘的点击。 */
export function setMaintenanceFrozen(value: boolean) {
  if (frozen === value) return
  frozen = value
  for (const listener of listeners) listener()
}
export const maintenanceWritesFrozen = () => frozen
export function useMaintenanceFrozen() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    maintenanceWritesFrozen,
    () => false
  )
}

const maintenanceAllowed = new Set<ModelOperation>([
  "list",
  "revealKey",
  "providers",
  "sessionCatalog",
  "sessionRead",
  "authPoll",
  "authCancel",
  "workspaceList",
  "workspaceGet",
  "conversationList",
  "conversationInfo",
  "conversationRead",
  "conversationFollow",
  "conversationReceiptRead",
  "conversationStop",
  "conversationQueueReceiptRead",
  "conversationControlRead",
  "conversationCompactCancel",
  "materialCatalog",
  "materialPreview",
  "materialRestore",
  "mcpList",
  "extensionList",
  "writeReceiptRead",
  "conversationPermissionRead",
  "conversationCommandRead",
])
export function maintenanceAllowsRpc(operation: ModelOperation) {
  return !frozen || maintenanceAllowed.has(operation)
}

/** 每个状态所有者保存自己的原身份副本，不能由全局监听猜测已保存。 */
export function useMaintenanceSave(save: SaveParticipant) {
  const latest = useRef(save)
  useLayoutEffect(() => {
    latest.current = save
  }, [save])
  useEffect(() => {
    const key = Symbol("maintenance-save")
    participants.set(key, () => latest.current())
    return () => {
      participants.delete(key)
    }
  }, [])
}
export function frontendBlocker(id: string, label: string): Activity {
  return { id, label, kind: "frontend", sessionId: null, stoppable: false }
}
export function useMaintenanceBlocker(
  id: string,
  label: string,
  blocked: boolean
) {
  useMaintenanceSave(() => (blocked ? [frontendBlocker(id, label)] : []))
}
export async function saveForMaintenance() {
  const blockers: Activity[] = []
  for (const [key, save] of [...participants]) {
    if (!participants.has(key)) continue
    try {
      const result = await save()
      if (result) blockers.push(...result)
    } catch {
      blockers.push(
        frontendBlocker(
          "local-save",
          "本机草稿或恢复记录未能保存，请释放空间后重试。"
        )
      )
    }
  }
  return blockers
}
