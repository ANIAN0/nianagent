import type { StorageInfo } from "@/contracts/desktop.generated"
import { prepareFrontendRecovery } from "@/lib/maintenance/frontend-recovery"

/** 只恢复当前已核验profile；阶段/身份ack由BootApp与权威宿主单一管理。 */
export function recoverStartupProfile(storage: StorageInfo) {
  prepareFrontendRecovery(storage.directoryMappings)
}
