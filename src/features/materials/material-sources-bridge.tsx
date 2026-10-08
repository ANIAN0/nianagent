import { useMaterialSources } from "./use-material-sources"

/** 监听与视图 DOM 同生共灭；错误恢复只重建监听，不取消上层准备任务。 */
export function MaterialSourcesBridge(
  props: Parameters<typeof useMaterialSources>[0]
) {
  useMaterialSources(props)
  return null
}
