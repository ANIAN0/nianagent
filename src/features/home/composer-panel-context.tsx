import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"
import { nextComposerPanel } from "./composer-panel-state"

type ComposerPanelContextValue = {
  active: string | null
  inactive: boolean
  setActive: Dispatch<SetStateAction<string | null>>
}

const ComposerPanelContext = createContext<ComposerPanelContextValue | null>(
  null
)

/** Scope one operation surface to one composer, including its portal children. */
export function ComposerPanelProvider({
  children,
  inactive = false,
}: {
  children: ReactNode
  inactive?: boolean
}) {
  const [active, setActive] = useState<string | null>(null)
  const [inactivePhase, setInactivePhase] = useState(inactive)
  // A visibility boundary resets ownership before committing the children;
  // reactivation therefore never resurrects a portal from the hidden phase.
  if (inactivePhase !== inactive) {
    setInactivePhase(inactive)
    if (inactive) setActive(null)
  }
  const value = useMemo(
    () => ({ active: inactive ? null : active, setActive, inactive }),
    [active, inactive]
  )
  return (
    <ComposerPanelContext.Provider value={value}>
      {children}
    </ComposerPanelContext.Provider>
  )
}

export function useComposerPanel(
  name: string,
  defaultOpen = false
): [boolean, (open: boolean) => void] {
  const context = useContext(ComposerPanelContext)
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const setActive = context?.setActive
  const inactive = context?.inactive ?? false
  const setOpen = useCallback(
    (open: boolean) => {
      if (open && inactive) return
      if (setActive)
        setActive((current) => nextComposerPanel(current, name, open))
      else setLocalOpen(open)
    },
    [name, setActive, inactive]
  )
  useEffect(() => {
    if (!setActive) return
    return () => {
      setActive((current) => nextComposerPanel(current, name, false))
    }
  }, [name, setActive])
  return [context ? !inactive && context.active === name : localOpen, setOpen]
}

export function useComposerPanelInactive() {
  return useContext(ComposerPanelContext)?.inactive ?? false
}

/** Radix must not return focus to an old trigger after another panel took over. */
export function useComposerPanelCloseAutoFocus(name: string) {
  const context = useContext(ComposerPanelContext)
  const active = context?.active
  const inactive = context?.inactive ?? false
  return useCallback(
    (event: Event) => {
      if (inactive || (active && active !== name)) event.preventDefault()
    },
    [active, name, inactive]
  )
}
