import {
  createContext,
  useContext,
  type ComponentType,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react"
import type { FeedbackDescription } from "@/lib/operation-issue"
import type { MaterialService } from "./material-service-port"
import type { Material } from "./types"

type MaterialUpdate = (apply: (materials: Material[]) => Material[]) => void

export type MaterialPreparationInput = {
  sessionId?: string
  cwd: string
  materials: Material[]
  update: MaterialUpdate
  disabled?: boolean
  onSelectionActivity?: (active: boolean) => void
  onPasteText?: (text: string, start: number, end: number) => void
}

export type MaterialSourcePorts = {
  scopeOwner: RefObject<{ scope: string }>
  owns: (owner: { scope: string }) => boolean
  setDropState: Dispatch<SetStateAction<{ scope: string; active: boolean }>>
  scope: string
  latest: RefObject<{
    materials: Material[]
    update: MaterialUpdate
    disabled: boolean
    scope: string
    onPasteText:
      | ((text: string, start: number, end: number) => void)
      | undefined
  }>
  service: MaterialService | null
  cwd: string
  upload: (file: File) => Promise<void>
  prepare: (source: Material) => Promise<void>
  setAction: Dispatch<
    SetStateAction<{
      scope: string
      choosing: boolean
      feedback: FeedbackDescription | undefined
    }>
  >
}

export type MaterialPreparationPresentation = {
  sourcePorts: MaterialSourcePorts
  service: MaterialService | null
  referenceIdentities: Material[]
  ready: boolean
  choosing: boolean
  dropActive: boolean
  error: string
  feedback: FeedbackDescription | undefined
  choose: () => Promise<void>
  discard: (id: string) => void
  prepare: (source: Material) => Promise<void>
  retry: (id: string) => Promise<void>
  canRetry: (id: string) => boolean
  retryLabel: (id: string) => string
  clearError: () => void
  recheck: () => void
}

export type MaterialSourcesProps = MaterialSourcePorts & {
  anchorNode: HTMLDivElement | null
}

export type MaterialRuntimePort = {
  useComposerMaterials: (
    props: MaterialPreparationInput & { anchorNode: HTMLDivElement | null }
  ) => Omit<MaterialPreparationPresentation, "sourcePorts">
  useMaterialPreparation: (
    props: MaterialPreparationInput
  ) => MaterialPreparationPresentation
  MaterialSourcesBridge: ComponentType<MaterialSourcesProps>
}

export const MaterialRuntimeContext = createContext<MaterialRuntimePort | null>(
  null
)

export function useMaterialRuntime(): MaterialRuntimePort {
  const runtime = useContext(MaterialRuntimeContext)
  if (!runtime) {
    throw new Error("材料准备运行时尚未装配。")
  }
  return runtime
}
