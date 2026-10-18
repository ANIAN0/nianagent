import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { PluginDevelopmentPage } from "./plugin-development-page"
import { DeveloperToolsSettings } from "../settings/developer-tools-settings"
import { SettingsShell } from "../settings/settings-shell"
import { useState } from "react"
import type { SettingsSection } from "../settings/settings-shell"

function DeveloperSettingsExample() {
  const [section, setSection] = useState<SettingsSection>("developer")
  return (
    <SettingsShell
      section={section}
      onSelect={setSection}
      onReturn={() => setSection("developer")}
    >
      {section === "developer" ? (
        <DeveloperToolsSettings />
      ) : (
        <div className="settings-page">
          此展示仅装配开发工具；从设置导航返回开发工具。
        </div>
      )}
    </SettingsShell>
  )
}

export default {
  id: "plugin-development",
  name: "插件开发规范",
  source: "src/features/plugin-development/plugin-development-page.tsx",
  layer: "页面",
  group: "页面与流程",
  order: 8,
  pages: ["设置", "插件开发"],
  stage: "content",
  description:
    "正式版与开发模式共用的只读插件规范，目录与正文来自同一个发布内容文件。",
  boundary:
    "直接复用正式组件与规范；不加载插件、不读取会话、不调用宿主。独立网页和设置内阅读使用相同组件。",
  standards: [
    {
      id: "source",
      name: "单源规范",
      rule: "导航和正文均读取 plugin-spec.md。",
      reason: "防止多份文档不一致。",
      check: "章节切换可看到相同规范与接口状态。",
    },
    {
      id: "status",
      name: "目标与现状",
      rule: "规范关联当前正式接口与真实示例。",
      reason: "文档上线不表示新 SDK 已可用。",
      check: "接口章节链接注册类型、资源协议和短记录示例。",
    },
    {
      id: "layout",
      name: "有界阅读",
      rule: "共用阅读外壳：宽容器显示章节与页内目录，窄容器以菜单打开章节；表格局部横向滚动。",
      reason: "设置内与独立页面空间不同。",
      check: "窄窗可切章节、阅读长表并返回开发工具。",
    },
  ],
  props: [
    {
      name: "section",
      type: "string | undefined",
      default: "首章",
      description: "可选受控章节；未知值显示首章。",
    },
    {
      name: "onSectionChange",
      type: "(section: string) => void",
      default: "内部状态",
      description: "独立页用于同步地址及浏览器历史。",
    },
    {
      name: "onReturn",
      type: "() => void",
      default: "不显示返回按钮",
      description: "设置页返回开发工具列表。",
    },
  ],
  inputs: ["规范正文", "可选章节和返回事件"],
  events: ["选择章节", "查找章节", "返回开发工具"],
  composition: [
    "Button",
    "Field",
    "Input",
    "Select",
    "Table",
    "Empty",
    "ReactMarkdown",
  ],
  consumers: ["DeveloperToolsSettings", "devtools/plugin-development.tsx"],
  viewport: { width: 1100, height: 760 },
  states: [
    {
      id: "reading",
      name: "完整规范阅读",
      section: "normal",
      condition: "打开插件开发页面。",
      expected: "可以搜索章节并查看规范，正文不依赖宿主。",
      steps: [
        "宽容器查找文件；窄容器打开章节选择器",
        "选择文件列表归属",
        "清空搜索（如有）并选择接口与实现状态",
      ],
      render: () => <PluginDevelopmentPage />,
    },
    {
      id: "settings",
      name: "从开发工具进入与返回",
      section: "normal",
      condition: "设置中打开开发工具分区。",
      expected: "查看规范后可返回同一工具列表。",
      steps: ["点击查看规范", "选择章节", "返回开发工具"],
      render: () => <DeveloperSettingsExample />,
    },
  ],
} satisfies CatalogEntry
