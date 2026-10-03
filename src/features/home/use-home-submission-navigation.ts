import { useLayoutEffect, useRef } from "react"

/** Keep irreversible receipt cleanup separate from the originating view's navigation. */
export function useHomeSubmissionNavigation(viewKey = 0) {
  const generation = useRef(0)
  const previousKey = useRef(viewKey)
  useLayoutEffect(() => {
    if (previousKey.current !== viewKey) {
      generation.current++
      previousKey.current = viewKey
    }
  }, [viewKey])
  return {
    leave() {
      generation.current++
    },
    capture() {
      const origin = generation.current
      return () => generation.current === origin
    },
  }
}
