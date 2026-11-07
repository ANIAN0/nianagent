// 由一次性迁移脚本生成：ui-catalog 目录内容固化后的聚合注册表与渲染桥。
// 每个条目 id 映射 catalog:<目录 id>；states.render 是迁移自目录条目的真实渲染函数。
import type { ComponentType } from "react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  installPreviewStorage,
  installPreviewNetwork,
} from "../fixtures/memory-storage"
import type { CatalogEntry } from "./catalog-types"
import catalog_src_components_composer_file_reference_catalog from "./src/components/composer/file-reference.catalog"
import catalog_src_components_composer_model_picker_catalog from "./src/components/composer/model-picker.catalog"
import catalog_src_components_composer_prompt_input_catalog from "./src/components/composer/prompt-input.catalog"
import catalog_src_components_composer_selected_materials_catalog from "./src/components/composer/selected-materials.catalog"
import catalog_src_components_composer_session_config_catalog from "./src/components/composer/session-config.catalog"
import catalog_src_components_read_only_patch_catalog from "./src/components/read-only-patch.catalog"
import catalog_src_components_ui_alert_catalog from "./src/components/ui/alert.catalog"
import catalog_src_components_ui_attachment_catalog from "./src/components/ui/attachment.catalog"
import catalog_src_components_ui_badge_catalog from "./src/components/ui/badge.catalog"
import catalog_src_components_ui_button_catalog from "./src/components/ui/button.catalog"
import catalog_src_components_ui_checkbox_catalog from "./src/components/ui/checkbox.catalog"
import catalog_src_components_ui_collapsible_catalog from "./src/components/ui/collapsible.catalog"
import catalog_src_components_ui_dialog_catalog from "./src/components/ui/dialog.catalog"
import catalog_src_components_ui_dropdown_menu_catalog from "./src/components/ui/dropdown-menu.catalog"
import catalog_src_components_ui_empty_catalog from "./src/components/ui/empty.catalog"
import catalog_src_components_ui_field_catalog from "./src/components/ui/field.catalog"
import catalog_src_components_ui_input_group_catalog from "./src/components/ui/input-group.catalog"
import catalog_src_components_ui_input_catalog from "./src/components/ui/input.catalog"
import catalog_src_components_ui_notification_toast_catalog from "./src/components/ui/notification-toast.catalog"
import catalog_src_components_ui_popover_catalog from "./src/components/ui/popover.catalog"
import catalog_src_components_ui_radio_group_catalog from "./src/components/ui/radio-group.catalog"
import catalog_src_components_ui_select_catalog from "./src/components/ui/select.catalog"
import catalog_src_components_ui_separator_catalog from "./src/components/ui/separator.catalog"
import catalog_src_components_ui_skeleton_catalog from "./src/components/ui/skeleton.catalog"
import catalog_src_components_ui_switch_catalog from "./src/components/ui/switch.catalog"
import catalog_src_components_ui_table_catalog from "./src/components/ui/table.catalog"
import catalog_src_components_ui_tabs_catalog from "./src/components/ui/tabs.catalog"
import catalog_src_components_ui_textarea_catalog from "./src/components/ui/textarea.catalog"
import catalog_src_components_ui_tooltip_catalog from "./src/components/ui/tooltip.catalog"
import catalog_src_features_conversation_composer_conversation_context_catalog from "./src/features/conversation/composer/conversation-context.catalog"
import catalog_src_features_conversation_composer_conversation_idle_input_catalog from "./src/features/conversation/composer/conversation-idle-input.catalog"
import catalog_src_features_conversation_composer_running_message_input_catalog from "./src/features/conversation/composer/running-message-input.catalog"
import catalog_src_features_conversation_controls_conversation_fork_catalog from "./src/features/conversation/controls/conversation-fork.catalog"
import catalog_src_features_conversation_conversation_page_catalog from "./src/features/conversation/conversation-page.catalog"
import catalog_src_features_conversation_conversation_reading_catalog from "./src/features/conversation/conversation-reading.catalog"
import catalog_src_features_conversation_conversation_recovery_catalog from "./src/features/conversation/conversation-recovery.catalog"
import catalog_src_features_conversation_messages_conversation_execution_catalog from "./src/features/conversation/messages/conversation-execution.catalog"
import catalog_src_features_conversation_messages_conversation_materials_catalog from "./src/features/conversation/messages/conversation-materials.catalog"
import catalog_src_features_conversation_permissions_conversation_approval_catalog from "./src/features/conversation/permissions/conversation-approval.catalog"
import catalog_src_features_conversation_permissions_permission_picker_catalog from "./src/features/conversation/permissions/permission-picker.catalog"
import catalog_src_features_home_app_shell_catalog from "./src/features/home/app-shell.catalog"
import catalog_src_features_home_home_composer_catalog from "./src/features/home/home-composer.catalog"
import catalog_src_features_home_home_page_catalog from "./src/features/home/home-page.catalog"
import catalog_src_features_home_skill_call_catalog from "./src/features/home/skill-call.catalog"
import catalog_src_features_home_workspace_picker_catalog from "./src/features/home/workspace-picker.catalog"
import catalog_src_features_models_model_editor_catalog from "./src/features/models/model-editor.catalog"
import catalog_src_features_plugins_plugin_settings_catalog from "./src/features/plugins/plugin-settings.catalog"
import catalog_src_features_plugins_plugin_sidebar_catalog from "./src/features/plugins/plugin-sidebar.catalog"
import catalog_src_features_settings_settings_catalog from "./src/features/settings/settings.catalog"
import catalog_src_features_startup_startup_migration_catalog from "./src/features/startup/startup-migration.catalog"
import catalog_src_features_startup_startup_surface_catalog from "./src/features/startup/startup-surface.catalog"
import catalog_plugins_file_workbench_source_viewer_catalog from "./plugins/file-workbench/source-viewer.catalog"
import catalog_plugins_file_workbench_workbench_catalog from "./plugins/file-workbench/workbench.catalog"
import catalog_plugins_logs_web_catalog from "./plugins/logs/web.catalog"
import catalog_plugins_mcp_service_web_catalog from "./plugins/mcp-service/web.catalog"
import catalog_plugins_opencli_web_catalog from "./plugins/opencli/web.catalog"

installPreviewStorage()
installPreviewNetwork()

const registry: Record<string, CatalogEntry> = {}
if (catalog_src_components_composer_file_reference_catalog.id)
  registry[
    "catalog:" + catalog_src_components_composer_file_reference_catalog.id
  ] = catalog_src_components_composer_file_reference_catalog
if (catalog_src_components_composer_model_picker_catalog.id)
  registry[
    "catalog:" + catalog_src_components_composer_model_picker_catalog.id
  ] = catalog_src_components_composer_model_picker_catalog
if (catalog_src_components_composer_prompt_input_catalog.id)
  registry[
    "catalog:" + catalog_src_components_composer_prompt_input_catalog.id
  ] = catalog_src_components_composer_prompt_input_catalog
if (catalog_src_components_composer_selected_materials_catalog.id)
  registry[
    "catalog:" + catalog_src_components_composer_selected_materials_catalog.id
  ] = catalog_src_components_composer_selected_materials_catalog
if (catalog_src_components_composer_session_config_catalog.id)
  registry[
    "catalog:" + catalog_src_components_composer_session_config_catalog.id
  ] = catalog_src_components_composer_session_config_catalog
if (catalog_src_components_read_only_patch_catalog.id)
  registry["catalog:" + catalog_src_components_read_only_patch_catalog.id] =
    catalog_src_components_read_only_patch_catalog
if (catalog_src_components_ui_alert_catalog.id)
  registry["catalog:" + catalog_src_components_ui_alert_catalog.id] =
    catalog_src_components_ui_alert_catalog
if (catalog_src_components_ui_attachment_catalog.id)
  registry["catalog:" + catalog_src_components_ui_attachment_catalog.id] =
    catalog_src_components_ui_attachment_catalog
if (catalog_src_components_ui_badge_catalog.id)
  registry["catalog:" + catalog_src_components_ui_badge_catalog.id] =
    catalog_src_components_ui_badge_catalog
if (catalog_src_components_ui_button_catalog.id)
  registry["catalog:" + catalog_src_components_ui_button_catalog.id] =
    catalog_src_components_ui_button_catalog
if (catalog_src_components_ui_checkbox_catalog.id)
  registry["catalog:" + catalog_src_components_ui_checkbox_catalog.id] =
    catalog_src_components_ui_checkbox_catalog
if (catalog_src_components_ui_collapsible_catalog.id)
  registry["catalog:" + catalog_src_components_ui_collapsible_catalog.id] =
    catalog_src_components_ui_collapsible_catalog
if (catalog_src_components_ui_dialog_catalog.id)
  registry["catalog:" + catalog_src_components_ui_dialog_catalog.id] =
    catalog_src_components_ui_dialog_catalog
if (catalog_src_components_ui_dropdown_menu_catalog.id)
  registry["catalog:" + catalog_src_components_ui_dropdown_menu_catalog.id] =
    catalog_src_components_ui_dropdown_menu_catalog
if (catalog_src_components_ui_empty_catalog.id)
  registry["catalog:" + catalog_src_components_ui_empty_catalog.id] =
    catalog_src_components_ui_empty_catalog
if (catalog_src_components_ui_field_catalog.id)
  registry["catalog:" + catalog_src_components_ui_field_catalog.id] =
    catalog_src_components_ui_field_catalog
if (catalog_src_components_ui_input_group_catalog.id)
  registry["catalog:" + catalog_src_components_ui_input_group_catalog.id] =
    catalog_src_components_ui_input_group_catalog
if (catalog_src_components_ui_input_catalog.id)
  registry["catalog:" + catalog_src_components_ui_input_catalog.id] =
    catalog_src_components_ui_input_catalog
if (catalog_src_components_ui_notification_toast_catalog.id)
  registry[
    "catalog:" + catalog_src_components_ui_notification_toast_catalog.id
  ] = catalog_src_components_ui_notification_toast_catalog
if (catalog_src_components_ui_popover_catalog.id)
  registry["catalog:" + catalog_src_components_ui_popover_catalog.id] =
    catalog_src_components_ui_popover_catalog
if (catalog_src_components_ui_radio_group_catalog.id)
  registry["catalog:" + catalog_src_components_ui_radio_group_catalog.id] =
    catalog_src_components_ui_radio_group_catalog
if (catalog_src_components_ui_select_catalog.id)
  registry["catalog:" + catalog_src_components_ui_select_catalog.id] =
    catalog_src_components_ui_select_catalog
if (catalog_src_components_ui_separator_catalog.id)
  registry["catalog:" + catalog_src_components_ui_separator_catalog.id] =
    catalog_src_components_ui_separator_catalog
if (catalog_src_components_ui_skeleton_catalog.id)
  registry["catalog:" + catalog_src_components_ui_skeleton_catalog.id] =
    catalog_src_components_ui_skeleton_catalog
if (catalog_src_components_ui_switch_catalog.id)
  registry["catalog:" + catalog_src_components_ui_switch_catalog.id] =
    catalog_src_components_ui_switch_catalog
if (catalog_src_components_ui_table_catalog.id)
  registry["catalog:" + catalog_src_components_ui_table_catalog.id] =
    catalog_src_components_ui_table_catalog
if (catalog_src_components_ui_tabs_catalog.id)
  registry["catalog:" + catalog_src_components_ui_tabs_catalog.id] =
    catalog_src_components_ui_tabs_catalog
if (catalog_src_components_ui_textarea_catalog.id)
  registry["catalog:" + catalog_src_components_ui_textarea_catalog.id] =
    catalog_src_components_ui_textarea_catalog
if (catalog_src_components_ui_tooltip_catalog.id)
  registry["catalog:" + catalog_src_components_ui_tooltip_catalog.id] =
    catalog_src_components_ui_tooltip_catalog
if (catalog_src_features_conversation_composer_conversation_context_catalog.id)
  registry[
    "catalog:" +
      catalog_src_features_conversation_composer_conversation_context_catalog.id
  ] = catalog_src_features_conversation_composer_conversation_context_catalog
if (
  catalog_src_features_conversation_composer_conversation_idle_input_catalog.id
)
  registry[
    "catalog:" +
      catalog_src_features_conversation_composer_conversation_idle_input_catalog.id
  ] = catalog_src_features_conversation_composer_conversation_idle_input_catalog
if (catalog_src_features_conversation_composer_running_message_input_catalog.id)
  registry[
    "catalog:" +
      catalog_src_features_conversation_composer_running_message_input_catalog.id
  ] = catalog_src_features_conversation_composer_running_message_input_catalog
if (catalog_src_features_conversation_controls_conversation_fork_catalog.id)
  registry[
    "catalog:" +
      catalog_src_features_conversation_controls_conversation_fork_catalog.id
  ] = catalog_src_features_conversation_controls_conversation_fork_catalog
if (catalog_src_features_conversation_conversation_page_catalog.id)
  registry[
    "catalog:" + catalog_src_features_conversation_conversation_page_catalog.id
  ] = catalog_src_features_conversation_conversation_page_catalog
if (catalog_src_features_conversation_conversation_reading_catalog.id)
  registry[
    "catalog:" +
      catalog_src_features_conversation_conversation_reading_catalog.id
  ] = catalog_src_features_conversation_conversation_reading_catalog
if (catalog_src_features_conversation_conversation_recovery_catalog.id)
  registry[
    "catalog:" +
      catalog_src_features_conversation_conversation_recovery_catalog.id
  ] = catalog_src_features_conversation_conversation_recovery_catalog
if (
  catalog_src_features_conversation_messages_conversation_execution_catalog.id
)
  registry[
    "catalog:" +
      catalog_src_features_conversation_messages_conversation_execution_catalog.id
  ] = catalog_src_features_conversation_messages_conversation_execution_catalog
if (
  catalog_src_features_conversation_messages_conversation_materials_catalog.id
)
  registry[
    "catalog:" +
      catalog_src_features_conversation_messages_conversation_materials_catalog.id
  ] = catalog_src_features_conversation_messages_conversation_materials_catalog
if (
  catalog_src_features_conversation_permissions_conversation_approval_catalog.id
)
  registry[
    "catalog:" +
      catalog_src_features_conversation_permissions_conversation_approval_catalog.id
  ] =
    catalog_src_features_conversation_permissions_conversation_approval_catalog
if (catalog_src_features_conversation_permissions_permission_picker_catalog.id)
  registry[
    "catalog:" +
      catalog_src_features_conversation_permissions_permission_picker_catalog.id
  ] = catalog_src_features_conversation_permissions_permission_picker_catalog
if (catalog_src_features_home_app_shell_catalog.id)
  registry["catalog:" + catalog_src_features_home_app_shell_catalog.id] =
    catalog_src_features_home_app_shell_catalog
if (catalog_src_features_home_home_composer_catalog.id)
  registry["catalog:" + catalog_src_features_home_home_composer_catalog.id] =
    catalog_src_features_home_home_composer_catalog
if (catalog_src_features_home_home_page_catalog.id)
  registry["catalog:" + catalog_src_features_home_home_page_catalog.id] =
    catalog_src_features_home_home_page_catalog
if (catalog_src_features_home_skill_call_catalog.id)
  registry["catalog:" + catalog_src_features_home_skill_call_catalog.id] =
    catalog_src_features_home_skill_call_catalog
if (catalog_src_features_home_workspace_picker_catalog.id)
  registry["catalog:" + catalog_src_features_home_workspace_picker_catalog.id] =
    catalog_src_features_home_workspace_picker_catalog
if (catalog_src_features_models_model_editor_catalog.id)
  registry["catalog:" + catalog_src_features_models_model_editor_catalog.id] =
    catalog_src_features_models_model_editor_catalog
if (catalog_src_features_plugins_plugin_settings_catalog.id)
  registry[
    "catalog:" + catalog_src_features_plugins_plugin_settings_catalog.id
  ] = catalog_src_features_plugins_plugin_settings_catalog
if (catalog_src_features_plugins_plugin_sidebar_catalog.id)
  registry[
    "catalog:" + catalog_src_features_plugins_plugin_sidebar_catalog.id
  ] = catalog_src_features_plugins_plugin_sidebar_catalog
if (catalog_src_features_settings_settings_catalog.id)
  registry["catalog:" + catalog_src_features_settings_settings_catalog.id] =
    catalog_src_features_settings_settings_catalog
if (catalog_src_features_startup_startup_migration_catalog.id)
  registry[
    "catalog:" + catalog_src_features_startup_startup_migration_catalog.id
  ] = catalog_src_features_startup_startup_migration_catalog
if (catalog_src_features_startup_startup_surface_catalog.id)
  registry[
    "catalog:" + catalog_src_features_startup_startup_surface_catalog.id
  ] = catalog_src_features_startup_startup_surface_catalog
if (catalog_plugins_file_workbench_source_viewer_catalog.id)
  registry[
    "catalog:" + catalog_plugins_file_workbench_source_viewer_catalog.id
  ] = catalog_plugins_file_workbench_source_viewer_catalog
if (catalog_plugins_file_workbench_workbench_catalog.id)
  registry["catalog:" + catalog_plugins_file_workbench_workbench_catalog.id] =
    catalog_plugins_file_workbench_workbench_catalog
if (catalog_plugins_logs_web_catalog.id)
  registry["catalog:" + catalog_plugins_logs_web_catalog.id] =
    catalog_plugins_logs_web_catalog
if (catalog_plugins_mcp_service_web_catalog.id)
  registry["catalog:" + catalog_plugins_mcp_service_web_catalog.id] =
    catalog_plugins_mcp_service_web_catalog
if (catalog_plugins_opencli_web_catalog.id)
  registry["catalog:" + catalog_plugins_opencli_web_catalog.id] =
    catalog_plugins_opencli_web_catalog

/** structure 条目渲染旅程文档壳；与其余条目一致使用 tailwind，不依赖 catalog.css。 */
function StructureShell({ entry }: { entry: CatalogEntry }) {
  const journeys = entry.story?.journeys ?? []
  if (entry.story)
    return (
      <article
        className="mx-auto max-w-2xl p-8 text-sm leading-6"
        aria-label="用户故事与规划旅程"
      >
        <p className="text-[11px] font-semibold tracking-wide uppercase opacity-60">
          结构梳理 · 待逐项设计与验收
        </p>
        <section className="mt-4">
          <h2 className="text-base font-semibold">用户目标</h2>
          <p className="mt-1 opacity-80">{entry.story.goal}</p>
          <h3 className="mt-3 text-[13px] font-semibold">前置条件</h3>
          <ul className="mt-1 list-disc pl-5 opacity-80">
            {entry.story.preconditions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h3 className="mt-3 text-[13px] font-semibold">目标结果</h3>
          <p className="mt-1 opacity-80">{entry.story.result}</p>
        </section>
        <section className="mt-6">
          <h2 className="text-base font-semibold">用户旅程</h2>
          <p className="mt-1 text-xs opacity-60">
            这些旅程用于后续逐项完善，不是已通过的行为标准或可操作演示。
          </p>
          {journeys.map((journey) => (
            <section
              className="mt-4 rounded-lg border border-current/15 p-4"
              key={journey.name}
            >
              <h3 className="text-[13px] font-semibold">{journey.name}</h3>
              <p className="mt-1 opacity-80">
                <strong>起点：</strong>
                {journey.start}
              </p>
              <ol className="mt-2 list-decimal pl-5 opacity-80">
                {journey.steps.map((step, index) => (
                  <li key={index}>
                    <p>
                      <strong>操作：</strong>
                      {step.action}
                    </p>
                    <p>
                      <strong>反馈或恢复：</strong>
                      {step.feedback}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="mt-1 opacity-80">
                <strong>结束：</strong>
                {journey.end}
              </p>
            </section>
          ))}
          {!journeys.length && (
            <p className="mt-2 opacity-70">当前栏目旅程待后续梳理。</p>
          )}
        </section>
      </article>
    )
  return (
    <div
      className="flex min-h-64 items-center justify-center p-8"
      aria-label="组件空壳"
    >
      <Empty>
        <EmptyHeader>
          <EmptyTitle>内容待填充</EmptyTitle>
          <EmptyDescription>
            目录与组件结构确认后，再补充标准、状态和交互。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

function CatalogStateView({
  entry,
  stateId,
}: {
  entry: CatalogEntry
  stateId?: string
}) {
  if (entry.stage === "structure") return <StructureShell entry={entry} />
  const state =
    (stateId && entry.states.find((item) => item.id === stateId)) ||
    entry.states[0]
  if (!state)
    return (
      <p className="p-6 text-sm opacity-60">
        找不到状态：{stateId || "（未指定）"}
      </p>
    )
  return <>{state.render()}</>
}

export const catalogEntries: Record<string, ComponentType> = {}
for (const [entryId, entry] of Object.entries(registry)) {
  const id = entryId
  catalogEntries[id] = function CatalogEntryBridge({
    moonStateId,
  }: {
    moonStateId?: string
  }) {
    return <CatalogStateView entry={entry} stateId={moonStateId} />
  }
}
export const registryIds = Object.keys(registry)
