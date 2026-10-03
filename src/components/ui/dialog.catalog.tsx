import type { CatalogEntry } from "../../../ui-catalog/catalog"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./dialog"
import { Button } from "./button"
import { Input } from "./input"
function Example() {
  return (
    <div className="p-6">
      <Dialog>
        <DialogTrigger asChild>
          <Button>打开演示弹窗</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>演示弹窗</DialogTitle>
            <DialogDescription>检查 Escape 关闭及焦点返回。</DialogDescription>
          </DialogHeader>
          <Input aria-label="弹窗输入" placeholder="弹窗内输入" />
        </DialogContent>
      </Dialog>
    </div>
  )
}
export default {
  id: "dialog",
  name: "Dialog",
  layer: "基础组件",
  group: "弹层",
  source: "src/components/ui/dialog.tsx",
  description: "模态内容与焦点管理。",
  boundary:
    "每个弹窗提供标题和描述；打开状态可由父级控制。基础组件管理模态焦点，业务层负责保存期间的关闭/导航边界；不依赖DOM查询推断业务忙状态。",
  inputs: ["open/onOpenChange；showCloseButton。"],
  events: ["onOpenChange(open)。"],
  composition: ["Radix Dialog", "Button"],
  consumers: [
    "AppShell",
    "ConversationSearch",
    "SessionConfig",
    "DirectoryPicker",
    "AddConnectionDialog",
    "ModelEditor",
    "SettingsConfirmDialog",
    "PiAuthorization",
    "SubscriptionAuthorization",
    "MessageAttachments",
  ],
  viewport: { width: 480, height: 360 },
  states: [
    {
      id: "modal",
      name: "弹窗与焦点",
      condition: "由按钮触发。",
      expected: "焦点进入弹窗；Escape 关闭并返回触发器。",
      render: () => <Example />,
    },
  ],
} satisfies CatalogEntry
