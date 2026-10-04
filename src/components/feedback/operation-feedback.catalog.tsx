import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Button } from "@/components/ui/button"
import { OperationFeedback } from "./operation-feedback"

function ReadFailureExample() {
  const [recovered, setRecovered] = useState(false)
  return (
    <div className="p-6">
      <OperationFeedback
        title={recovered ? "已重新读取配置" : "未能读取会话配置"}
        message={
          recovered
            ? "可以继续编辑并发送消息。"
            : "当前输入已保留，请重新读取后继续。"
        }
        severity={recovered ? "info" : "error"}
        details={
          recovered ? undefined : "操作：读取会话配置\n错误类型：服务暂时不可用"
        }
        actions={
          recovered ? undefined : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRecovered(true)}
            >
              重新读取
            </Button>
          )
        }
      />
    </div>
  )
}

function UnknownExample() {
  const [confirmed, setConfirmed] = useState(false)
  return (
    <div className="p-6">
      <OperationFeedback
        title={confirmed ? "已核对发送结果" : "发送结果待确认"}
        message={
          confirmed
            ? "此示例原请求已被接受，结束待确认状态。"
            : "输入已保留。请先核对这次发送的结果，再继续操作。"
        }
        severity={confirmed ? "info" : "warning"}
        details={confirmed ? undefined : "操作：发送消息\n状态：未收到提交回执"}
        actions={
          confirmed ? undefined : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmed(true)}
            >
              核对发送
            </Button>
          )
        }
      />
    </div>
  )
}

export default {
  id: "operation-feedback",
  name: "操作反馈",
  layer: "复合组件",
  group: "反馈",
  source: "src/components/feedback/operation-feedback.tsx",
  description: "统一呈现用户原因、操作归属、恢复动作与可展开的安全诊断。",
  boundary:
    "只负责呈现。字段、消息行、表单、运行阶段各自持有问题和恢复动作；同一问题仅一处主要反馈，不在共享组件内重发请求。",
  inputs: [
    "title: 受影响对象与操作；message: 用户可理解的原因",
    "severity: error/warning/info；details: 可选安全诊断；actions: 所属操作的恢复控件",
  ],
  events: ["展开/收起诊断；触发调用方提供的恢复动作"],
  composition: ["Alert", "Button", "Collapsible"],
  consumers: [
    "HomeComposer",
    "LiveConversationView",
    "QueueDock",
    "McpSettings",
    "McpServerEditor",
    "SettingsConfirmDialog",
  ],
  viewport: { width: 720, height: 320 },
  states: [
    {
      id: "read-error",
      name: "失败与恢复",
      condition: "会话配置读取明确失败",
      expected: "原因与重新读取动作相邻，成功只清除此操作的问题，诊断默认折叠",
      render: () => <ReadFailureExample />,
    },
    {
      id: "unknown",
      name: "结果待确认",
      condition: "请求响应丢失，尚未确认提交结果",
      expected: "使用警告层级，保留输入，只提供核对原请求的动作",
      render: () => <UnknownExample />,
    },
    {
      id: "cancelled",
      name: "普通取消",
      condition: "用户主动取消连接测试",
      expected: "以普通状态说明取消和输入保留，不使用红色失败样式",
      render: () => (
        <div className="p-6">
          <OperationFeedback
            title="测试已取消"
            message="服务参数和未保存草稿已保留，可以继续编辑。"
            severity="info"
          />
        </div>
      ),
    },
    {
      id: "waiting",
      name: "保存等待",
      condition: "保存已开始，需要等待提交结果",
      expected: "普通状态说明当前操作，等待不被表示为错误",
      render: () => (
        <div className="p-6">
          <OperationFeedback
            title="正在保存配置"
            message="正在等待保存结果，请稍候。输入会保留到结果确认。"
            severity="info"
          />
        </div>
      ),
    },
    {
      id: "long-detail",
      name: "长诊断与窄视口",
      condition: "错误包含安全代码和较长操作诊断",
      expected: "摘要可读，技术信息默认折叠并局部滚动，不撑开页面或暴露凭据",
      render: () => (
        <div className="p-6">
          <OperationFeedback
            title="未能保存待处理消息"
            message="待处理消息与修改文字已保留。请关闭占用配置文件的程序后重试原操作。"
            details={Array.from(
              { length: 12 },
              (_, i) =>
                `检查 ${i + 1}：队列配置提交，文件系统错误 EPERM / rename。未返回凭据、接口地址或请求正文。`
            ).join("\n")}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
