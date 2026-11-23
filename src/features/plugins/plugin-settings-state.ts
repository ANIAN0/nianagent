import type {
  PluginDescriptor,
  PluginPackageTask,
} from "@/contracts/rpc.generated"
import { readExtensionConfiguration } from "@/features/extensions/extension-configuration-fields"

/** 包任务进行中：列表行以阶段替代常规状态，任务终态后回落。 */
export const TASK_ACTIVE_PHASES = ["running", "applying", "cancelling"]
export function taskLabel(task?: PluginPackageTask) {
  if (!task || !TASK_ACTIVE_PHASES.includes(task.phase)) return ""
  if (task.phase === "applying") return "正在应用…"
  if (task.phase === "cancelling") return "正在取消…"
  return task.action === "update" ? "正在更新…" : "正在安装…"
}

export type ConfigurationDraft = ReturnType<
  typeof readExtensionConfiguration
> & {
  source: string
  savedValue: string
  savedSchema: string
  conflict: boolean
}
export function readConfigurationDraft(
  plugin: PluginDescriptor
): ConfigurationDraft {
  const saved = readExtensionConfiguration(
    plugin.configurationSchema,
    plugin.configuration
  )
  const savedValue = JSON.stringify(saved.configuration)
  const savedSchema = JSON.stringify(saved.schema)
  return {
    ...saved,
    source: JSON.stringify([savedSchema, savedValue]),
    savedValue,
    savedSchema,
    conflict: false,
  }
}
export function reconcileDrafts(
  plugins: PluginDescriptor[],
  drafts: Record<string, ConfigurationDraft>
) {
  const next: Record<string, ConfigurationDraft> = {}
  for (const plugin of plugins) {
    const previous = drafts[plugin.id]
    try {
      const saved = readConfigurationDraft(plugin)
      if (!previous) {
        next[plugin.id] = saved
        continue
      }
      if (previous.source === saved.source) {
        next[plugin.id] = previous
        continue
      }
      const draftValue = JSON.stringify(previous.configuration)
      const clean = draftValue === previous.savedValue && !previous.conflict
      const matches =
        draftValue === saved.savedValue &&
        previous.savedSchema === saved.savedSchema
      next[plugin.id] =
        clean || matches
          ? saved
          : { ...previous, source: saved.source, conflict: true }
    } catch {
      // A damaged descriptor must not discard an existing local draft.
      if (previous) next[plugin.id] = previous
    }
  }
  return next
}
export type PluginStatusTone =
  "active" | "muted" | "destructive" | "warning" | "pending"

export type NormalizedPluginStatus = {
  label: string
  tone: PluginStatusTone
}

/** 列表与详情标题共用的归一化短状态；底层运行时诊断信息（businessState）统一下沉到详情页展示。 */
export function pluginNormalizedStatus(
  plugin: PluginDescriptor,
  task?: PluginPackageTask
): NormalizedPluginStatus {
  const activeTask = taskLabel(task)
  if (activeTask) return { label: activeTask, tone: "pending" }
  if (!plugin.installed) return { label: "待安装", tone: "warning" }
  if (plugin.state === "failed") return { label: "异常", tone: "destructive" }
  if (plugin.state === "loading") return { label: "正在启用", tone: "pending" }
  if (plugin.state === "stopping") return { label: "正在停用", tone: "pending" }
  if (plugin.state === "active") return { label: "已启用", tone: "active" }
  return { label: "已停用", tone: "muted" }
}

export function pluginStatus(plugin: PluginDescriptor) {
  return pluginNormalizedStatus(plugin).label
}
export function configurationReadable(plugin: PluginDescriptor) {
  try {
    readExtensionConfiguration(plugin.configurationSchema, plugin.configuration)
    return true
  } catch {
    return false
  }
}
export function draftChanged(draft: ConfigurationDraft | undefined) {
  return (
    !!draft &&
    (draft.conflict || JSON.stringify(draft.configuration) !== draft.savedValue)
  )
}
