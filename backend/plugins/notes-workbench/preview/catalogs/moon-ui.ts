// moon-ui 白名单注册表：页面源码 `import { X } from "moon-ui"` 的解析来源。
// 只收录通用展示与交互组件；带业务副作用的模块（通知、消息流等）不进白名单。
import * as alert from "@/components/ui/alert"
import * as badge from "@/components/ui/badge"
import * as button from "@/components/ui/button"
import * as checkbox from "@/components/ui/checkbox"
import * as collapsible from "@/components/ui/collapsible"
import * as dialog from "@/components/ui/dialog"
import * as dropdownMenu from "@/components/ui/dropdown-menu"
import * as empty from "@/components/ui/empty"
import * as input from "@/components/ui/input"
import * as inputGroup from "@/components/ui/input-group"
import * as label from "@/components/ui/label"
import * as popover from "@/components/ui/popover"
import * as radioGroup from "@/components/ui/radio-group"
import * as select from "@/components/ui/select"
import * as separator from "@/components/ui/separator"
import * as skeleton from "@/components/ui/skeleton"
import * as switchUi from "@/components/ui/switch"
import * as table from "@/components/ui/table"
import * as tabs from "@/components/ui/tabs"
import * as textarea from "@/components/ui/textarea"
import * as tooltip from "@/components/ui/tooltip"

/** 页面源码 import { X } from "moon-ui" 的解析表。 */
export const moonUi: Record<string, unknown> = {
  ...alert,
  ...badge,
  ...button,
  ...checkbox,
  ...collapsible,
  ...dialog,
  ...dropdownMenu,
  ...empty,
  ...input,
  ...inputGroup,
  ...label,
  ...popover,
  ...radioGroup,
  ...select,
  ...separator,
  ...skeleton,
  ...switchUi,
  ...table,
  ...tabs,
  ...textarea,
  ...tooltip,
}

export * from "@/components/ui/alert"
export * from "@/components/ui/badge"
export * from "@/components/ui/button"
export * from "@/components/ui/checkbox"
export * from "@/components/ui/collapsible"
export * from "@/components/ui/dialog"
export * from "@/components/ui/dropdown-menu"
export * from "@/components/ui/empty"
export * from "@/components/ui/input"
export * from "@/components/ui/input-group"
export * from "@/components/ui/label"
export * from "@/components/ui/popover"
export * from "@/components/ui/radio-group"
export * from "@/components/ui/select"
export * from "@/components/ui/separator"
export * from "@/components/ui/skeleton"
export * from "@/components/ui/switch"
export * from "@/components/ui/table"
export * from "@/components/ui/tabs"
export * from "@/components/ui/textarea"
export * from "@/components/ui/tooltip"
