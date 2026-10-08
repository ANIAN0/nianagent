import { useMaterialPreparation } from "./use-material-preparation"
import { useMaterialSources } from "./use-material-sources"

/** 准备任务拥有取消/重试/迟到结果，来源适配只拥有 DOM 与原生监听。 */
export function useComposerMaterials(
  props: Parameters<typeof useMaterialPreparation>[0] & {
    anchorNode: HTMLDivElement | null
  }
) {
  const { sourcePorts, ...presentation } = useMaterialPreparation(props)
  useMaterialSources({ anchorNode: props.anchorNode, ...sourcePorts })
  return presentation
}
