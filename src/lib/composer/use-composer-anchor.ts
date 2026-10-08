import { useCallback, useRef, useState } from "react"

/** ref 供选择/定位读取，node 让监听跟随真实 DOM；切换编辑形态不重建任务 owner。 */
export function useComposerAnchor() {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [anchorNode, setAnchorNode] = useState<HTMLDivElement | null>(null)
  const bindAnchor = useCallback((node: HTMLDivElement | null) => {
    anchorRef.current = node
    setAnchorNode(node)
  }, [])
  return { anchorRef, anchorNode, bindAnchor }
}
