import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { HomeSubmissionNotice } from "./home-submission-notice"
import { RecoveryAction } from "@/components/feedback/recovery-action"

export default {
  id: "home-submission-notice",
  name: "首页发送提示",
  layer: "复合组件",
  group: "首页",
  source: "src/features/home/home-submission-notice.tsx",
  description: "明确未接受后恢复原输入，在输入上方显示就地警告。",
  boundary:
    "只负责通知展示和停留时间，不判断发送回执、清理草稿或调用模型。父级通过key区分每次通知。",
  inputs: [
    "message: 脱敏的产品原因；actions?: 正式恢复动作；persistent?: 需要处理的配置错误保留至关闭。",
  ],
  events: ["普通警告8秒自动收起，鼠标停留和键盘焦点暂停；关闭按钮立即收起。"],
  composition: ["Lucide TriangleAlert、X；正式Button与RecoveryAction。"],
  consumers: ["HomeComposer"],
  viewport: { width: 760, height: 340 },
  states: [
    {
      id: "restored",
      name: "输入已恢复",
      condition: "服务明确拒绝，原需求和次稿已保留。",
      expected: "紧凑警告显示在输入上方，不伪造消息或要求用户再点放回。",
      render: () => (
        <HomeSubmissionNotice message="消息未被接受，原输入和等待期间的新内容已合并保留。" />
      ),
    },
    {
      id: "configuration",
      name: "配置需重新读取",
      condition: "模型请求尚未发出，配置读取失败。",
      expected: "保留配置恢复动作，不能显示核对发送。",
      render: () => (
        <HomeSubmissionNotice
          persistent
          message="会话配置未能确认，消息尚未发送，原输入已恢复。"
          actions={
            <RecoveryAction
              issue={{
                code: "home_configuration_unconfirmed",
                message: "",
                recovery: "reload",
              }}
              onReload={() => Promise.resolve()}
              labels={{ reload: "重新读取配置" }}
            />
          }
        />
      ),
    },
  ],
} satisfies CatalogEntry
