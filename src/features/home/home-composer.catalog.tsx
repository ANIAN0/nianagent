import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { HomeComposer } from "./home-composer"
import { homeData, submitMockWork } from "../../../ui-catalog/fixtures/home"
export default {
  id: "home-composer",
  name: "工作输入区",
  layer: "复合组件",
  group: "首页",
  source: "src/features/home/home-composer.tsx",
  description: "选择工作上下文、编辑需求和材料，通过提交回调获得结果反馈。",
  boundary:
    "负责首页输入；正式App拥有持久草稿和提交，SessionServiceContext提供配置，MaterialServiceContext准备实际材料。目录使用隔离数据与替身，不调用模型或用户文件。",
  inputs: [
    "data: workspaces/models/materials/tools 可选资源。",
    "initialDraft?: Partial<HomeDraft>，初始需求、材料、模型和工具配置。",
    "onSubmit: SubmitWork，接收canonical草稿、AbortSignal及原始草稿；成功表示输入已接受，失败保留草稿。",
    "onDraftChange保存当前窗口草稿；onChooseWorkspace/onWorkspaceSelect由正式App接入系统目录选择和工作区服务。",
  ],
  events: [
    "提交需有效文字或就绪材料、有效目录和兼容模型；Enter发送、Shift+Enter换行，候选选择和输入法选字不提交。",
    "材料添加去重，可逐项移除；选项变化清除上次反馈。",
    "结果待核对时禁用新发送；核对原请求。发送前持久同一思考与材料身份，接受后的清理不依赖后来模型目录。",
  ],
  composition: [
    "WorkspacePicker、PromptInput、SelectedMaterials、ComposerToolbar",
    "ComposerToolbar 负责材料、模型、思考、配置与发送",
    "FieldGroup/Field、InputGroup",
  ],
  consumers: ["App（正式首页）", "HomePage（独立展示）"],
  viewport: { width: 800, height: 600 },
  states: [
    {
      id: "unconfirmed",
      name: "原请求待核对",
      condition: "原首页会话存在未清理提交身份。",
      expected: "新发送禁用，草稿可编辑；核对按钮不发送改写后的草稿。",
      render: () => (
        <HomeComposer
          data={homeData}
          initialDraft={{
            sessionId: "catalog-pending",
            text: "保留尚未确认的需求",
          }}
          unconfirmedSessionIds={["catalog-pending"]}
          onCheckSubmission={async () => {
            throw new Error("示例回执仍待确认，原草稿保留。")
          }}
          onSubmit={submitMockWork}
        />
      ),
    },
    {
      id: "empty",
      name: "空草稿",
      condition: "提供完整选项，需求为空。",
      expected: "发送禁用；可输入、选择目录或添加材料。",
      render: () => <HomeComposer data={homeData} onSubmit={submitMockWork} />,
    },
    {
      id: "materials",
      name: "带材料草稿",
      condition: "初始文本和附件/Skill 已选择。",
      expected: "显示材料名称；可移除、切换模型并发送，结果反映当前选择。",
      render: () => (
        <HomeComposer
          data={homeData}
          initialDraft={{
            text: "请检查首页交互与可访问性",
            materials: [homeData.materials[0]!, homeData.materials[2]!],
          }}
          onSubmit={submitMockWork}
        />
      ),
    },
    {
      id: "send-rejected",
      name: "发送未接受",
      condition: "提交函数在消息被接受前失败。",
      expected: "反馈靠近输入，原文字、模型与工作区保留，可修正后重新发送。",
      render: () => (
        <HomeComposer
          data={homeData}
          initialDraft={{
            text: "读取 README.md，确认两个入口使用同一个后端。",
          }}
          onSubmit={() => {
            throw new Error("模型不可用，消息尚未发送。请检查连接后重新发送。")
          }}
        />
      ),
    },
    {
      id: "unavailable",
      name: "资源不可用",
      condition: "目录、模型与材料均为空。",
      expected: "显示无可用目录/模型，输入内容也不能提交，无崩溃。",
      render: () => (
        <HomeComposer
          data={{ workspaces: [], models: [], materials: [], tools: [] }}
          initialDraft={{ text: "检查无资源状态" }}
          onSubmit={submitMockWork}
        />
      ),
    },
  ],
} satisfies CatalogEntry
