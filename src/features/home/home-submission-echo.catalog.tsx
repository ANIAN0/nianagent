import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { HomeSubmissionEcho } from "./home-submission-echo"

const submission = {
  sessionId: "catalog-local-echo",
  signatures: [],
  draft: {
    sessionId: "catalog-local-echo",
    workspaceId: "demo",
    model: "演示模型",
    thinking: "中",
    text: "先检查首页输入框的视觉关系、材料轨、候选和焦点，形成逐项清单。",
    materials: [],
    session: { toolIds: [], instructionScope: "all" as const },
  },
}

export default {
  id: "home-submission-echo",
  name: "首页提交副本",
  layer: "复合组件",
  group: "首页",
  source: "src/features/home/home-submission-echo.tsx",
  description:
    "确认首次发送期间的只读本地副本，与正式用户消息使用同一 UserMessage。",
  boundary:
    "父级持有不可变 HomeSubmission；此处仅呈现，不伪造历史条目、时间或消息详情，不重复发请求。",
  inputs: [
    "submission: 不可变原提交；workspacePath: 材料来源目录；accepted?: 接收已确认、交接尚待清理。",
    "checking?: 正在进行只读核对；unresolved?: 自动核对后仍未知；onCheck?: 手动读取原请求回执，不重发。",
  ],
  events: [
    "不提供发送、编辑或历史动作；有界容器支持键盘和局部滚动。准备好的材料通过正式MaterialPreviewDialog读取，inactive关闭预览且不返回隐藏触发器。",
  ],
  composition: [
    "UserMessage → Message、MessageContent、Bubble、MessageAttachments；MaterialPreviewDialog",
  ],
  consumers: ["HomeComposer"],
  viewport: { width: 800, height: 580 },
  states: [
    {
      id: "checking",
      name: "自动核对",
      condition: "首次发送回执丢失。",
      expected:
        "原回显旁紧凑中性状态；只读核对期间没有重发或手动重复检查按钮。",
      render: () => (
        <HomeSubmissionEcho
          submission={submission}
          workspacePath="/demo/moon"
          checking
        />
      ),
    },
    {
      id: "unknown",
      name: "持久未知恢复",
      condition: "有限自动核对仍未确认，或重新打开已有副本。",
      expected:
        "原回显旁说明接收未确认并提供检查发送状态；不出现输入区下方常驻大Alert。",
      render: () => (
        <HomeSubmissionEcho
          submission={submission}
          workspacePath="/demo/moon"
          unresolved
          onCheck={() => {}}
        />
      ),
    },
    {
      id: "waiting",
      name: "正在确认",
      condition: "原请求尚未回执。",
      expected:
        "正文同形显示；可访问状态宣布确认中，不出现假时间、详情或重复等待文案。",
      render: () => (
        <HomeSubmissionEcho
          submission={submission}
          workspacePath="/demo/moon"
        />
      ),
    },
    {
      id: "bounded",
      name: "长文与12材料",
      condition: "原提交包含长段文字和12文件。",
      expected:
        "副本最高220px或30dvh，内部滚动，输入区不受数量和正文长度挤压。",
      render: () => (
        <HomeSubmissionEcho
          submission={{
            ...submission,
            draft: {
              ...submission.draft,
              text: Array.from(
                { length: 20 },
                (_, index) =>
                  `${index + 1}. 请按已确认原型逐项核对输入与候选交互。`
              ).join("\n"),
              materials: Array.from({ length: 12 }, (_, index) => ({
                id: `echo-${index}`,
                name: `首页输入与材料状态验收-${index + 1}.md`,
                kind: "附件",
                type: "file",
                source: `docs/${index + 1}.md`,
                status: "ready",
              })),
            },
          }}
          workspacePath="/demo/moon"
        />
      ),
    },
    {
      id: "accepted-cleanup",
      name: "已接受待交接",
      condition: "远端已接受，本机次稿交接尚未完成。",
      expected:
        "副本继续保留，不再宣布等待确认；恢复动作由拥有持久状态的正式App承载。",
      render: () => (
        <HomeSubmissionEcho
          submission={submission}
          workspacePath="/demo/moon"
          accepted
        />
      ),
    },
  ],
} satisfies CatalogEntry
