import type { ReactNode } from "react"
import {
  DesktopServiceProvider,
  useDesktopLifecycle,
} from "@/features/settings/desktop-service"
import {
  maintenanceWritesFrozen,
  useMaintenanceFrozen,
} from "@/lib/maintenance/maintenance-coordinator"
import {
  PermissionServiceContext,
  type PermissionService,
} from "@/features/conversation/permissions/permission-service"
import {
  CommandServiceContext,
  type createCommandService,
} from "@/features/conversation/controls/command-service"
import {
  NavigationBoundaryContext,
  type useNavigationBoundaryState,
} from "@/lib/navigation/navigation-boundary"
import {
  SessionServiceContext,
  type SessionService,
} from "@/features/session/session-service"
import {
  MaterialServiceContext,
  type MaterialService,
} from "@/features/materials/material-service"
import {
  ExtensionServiceContext,
  type ExtensionService,
} from "@/features/extensions/extension-service"
import { MaterialRuntimeContext } from "@/lib/composer/material-runtime-port"
import {
  ExtensionManagerContext,
  PermissionControlContext,
  type ExtensionManagerSlotProps,
  type PermissionControlSlotProps,
} from "@/lib/composer/session-config-port"
import { useComposerMaterials } from "@/features/materials/use-composer-materials"
import { useMaterialPreparation } from "@/features/materials/use-material-preparation"
import { MaterialSourcesBridge } from "@/features/materials/material-sources-bridge"
import { SessionPermissionControl } from "@/features/conversation/permissions/permission-picker"
import { ExtensionConfig } from "@/features/extensions/extension-config"

const materialRuntime = {
  useComposerMaterials,
  useMaterialPreparation,
  MaterialSourcesBridge,
}

export type AppProvidersProps = {
  permissionService: PermissionService
  commandService: ReturnType<typeof createCommandService>
  navigation: ReturnType<typeof useNavigationBoundaryState>
  sessionService: SessionService
  materialService: MaterialService
  extensionService: ExtensionService
  children: ReactNode
}

export function AppProviders({
  permissionService,
  commandService,
  navigation,
  sessionService,
  materialService,
  extensionService,
  children,
}: AppProvidersProps) {
  const desktop = useDesktopLifecycle()
  const writesFrozen = useMaintenanceFrozen()

  return (
    <DesktopServiceProvider value={desktop}>
      <div
        className="contents"
        data-maintenance-frozen={writesFrozen}
        onBeforeInputCapture={(event) => {
          if (maintenanceWritesFrozen()) event.preventDefault()
        }}
        onPasteCapture={(event) => {
          if (maintenanceWritesFrozen()) event.preventDefault()
        }}
        onDropCapture={(event) => {
          if (maintenanceWritesFrozen()) event.preventDefault()
        }}
      >
        <PermissionServiceContext.Provider value={permissionService}>
          <CommandServiceContext.Provider value={commandService}>
            <NavigationBoundaryContext.Provider value={navigation}>
              <SessionServiceContext.Provider value={sessionService}>
                <MaterialServiceContext.Provider value={materialService}>
                  <ExtensionServiceContext.Provider value={extensionService}>
                    <MaterialRuntimeContext.Provider value={materialRuntime}>
                      <PermissionControlContext.Provider
                        value={(slotProps: PermissionControlSlotProps) => (
                          <SessionPermissionControl
                            key={slotProps.sessionId}
                            {...slotProps}
                          />
                        )}
                      >
                        <ExtensionManagerContext.Provider
                          value={(slotProps: ExtensionManagerSlotProps) => (
                            <ExtensionConfig
                              embedded
                              {...slotProps}
                              service={extensionService}
                            />
                          )}
                        >
                          {children}
                        </ExtensionManagerContext.Provider>
                      </PermissionControlContext.Provider>
                    </MaterialRuntimeContext.Provider>
                  </ExtensionServiceContext.Provider>
                </MaterialServiceContext.Provider>
              </SessionServiceContext.Provider>
            </NavigationBoundaryContext.Provider>
          </CommandServiceContext.Provider>
        </PermissionServiceContext.Provider>
      </div>
    </DesktopServiceProvider>
  )
}
