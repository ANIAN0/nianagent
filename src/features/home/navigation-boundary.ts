import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

type NavigationBoundary = {
  blocked: boolean
  acquire: () => () => void
  run: (action: () => void) => boolean
}

const unrestricted: NavigationBoundary = {
  blocked: false,
  acquire: () => () => {},
  run: (action) => {
    action()
    return true
  },
}

export const NavigationBoundaryContext = createContext(unrestricted)

/** A saving component holds a lease; every application navigation uses run. */
export function useNavigationBoundaryState(): NavigationBoundary {
  const leases = useRef(new Set<symbol>())
  const [blocked, setBlocked] = useState(false)
  const acquire = useCallback(() => {
    const lease = Symbol("saving")
    leases.current.add(lease)
    setBlocked(true)
    return () => {
      if (!leases.current.delete(lease)) return
      setBlocked(leases.current.size > 0)
    }
  }, [])
  const run = useCallback((action: () => void) => {
    // The ref also protects actions in the same event before React renders.
    if (leases.current.size) return false
    action()
    return true
  }, [])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!leases.current.size) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])
  return { blocked, acquire, run }
}

export function useNavigationBoundary() {
  return useContext(NavigationBoundaryContext)
}
