import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { HomeStoryExample } from "../../../ui-catalog/fixtures/home-stories"

export default {
  id: "model-picker",
  name: "设置模型",
  source: "src/features/home/model-picker.tsx",
  group: "设置模型",
  layer: "复合组件",
  order: 102,
  pages: ["首页"],
  stage: "content",
  description: "用户选择模型与该模型支持的思考强度，搜索和选择保持同一上下文。",
  boundary:
    "示例直接复用完整 HomeComposer，服务、草稿和浏览器存储只存在预览内存。演示到首页 onSubmit 回调结束，不模拟路由成功或 Agent 回复，不修改对话页面。 模型设置入口仅记录回调，不打开设置页或连接模型。",
  story: {
    goal: "选择将处理这条输入的模型，并设置有效的思考强度。",
    preconditions: [
      "演示连接提供文本模型和Vision模型。",
      "思考等级和输入类型由模型目录提供。",
    ],
    result:
      "草稿模型值、显示名和思考等级一致；换模型后等级合法，失效状态可恢复。",
  },
  standards: [
    {
      id: "U1",
      name: "同级入口",
      rule: "权限、模型和会话配置统一28px高、13px/20px、400字重、胶囊形状、左右8px/内部6px；权限在左，模型和会话配置在右。",
      reason:
        "同一工具栏的执行上下文选择必须有一致层级；位置延续用户已确认的权限区域。",
      check:
        "完整输入区及窄窗一起检查默认、悬停、展开、焦点和禁用；不能仅看孤立按钮。",
    },
    {
      id: "U2",
      name: "说明使用条件",
      rule: "完整可读入口和短选项不增加重复Tooltip；只有图标、实际截断名称或不可用原因才补全。模型不可用标记独立于可截断名称；读取中、读取失败与已确认不可用分别表达。非空输入且模型不可用时主动使用共享Toast，持续输入不重复通知，改选可用模型解除禁发并保留草稿。提示沿项目Tooltip规格。",
      reason: "浮窗要补缺失信息；重复标签只制造遮挡和多套风格。",
      check: "关闭与展开分别检查，不出现HTML title、双重浮窗或常驻正文说明。",
    },
    {
      id: "G3",
      name: "名称与图标",
      rule: "模型名优先，思考说明先收缩；无真实身份图标不添加装饰，极窄入口显示模型短标签。菜单240–420px，读取错误至少320px且原因与动作分行；根/候选34px、13px/20px、右侧选中标记。ID供搜索，清除仅一个自定义按钮，点击后焦点/全列表恢复。",
      reason: "对象身份比装饰图标更有价值；长名称不能挤走配置和发送。",
      check: "长名称和窄窗检查；图标必须能解释真实对象。",
    },
    {
      id: "G4",
      name: "选择与搜索",
      rule: "根菜单模型/思考分区，子级可返回；搜索筛选不改已选模型，只有确认才回写。",
      reason: "焦点、搜索和选择不是同一动作。",
      check: "搜索无匹配再清除，Esc退级，方向键移动后取消不改值。",
    },
  ],
  inputs: [
    "models:string[]；modelLabels显示名与value分离",
    "modelThinking[model] 提供有效等级；modelInputs[model] 提供text/image能力",
    "modelCatalog.items/status/error/onRetry/onOpenSettings",
  ],
  events: [
    "onChange(value) 选择模型；onThinkingChange(level) 改思考强度",
    "catalog.onRetry只恢复目录；onOpenSettings是明确导航边界",
  ],
  composition: [
    "ModelPicker / ThinkingPicker / Popover / InputGroup / PickerOption",
  ],
  consumers: ["首页输入工具栏"],
  states: [
    {
      id: "choose-model",
      name: "模型与思考选择",
      section: "normal",
      condition: "文本模型默认已选；Vision可选。",
      steps: [
        "打开模型入口进入模型子菜单。",
        "选择Vision，再打开思考子菜单选择高。",
        "查看当前入口与提交时模型、thinking值。",
        "用Esc关闭回正文。",
      ],
      expected:
        "模型与思考合法且一致，子菜单焦点连贯，未确认的移动不改变草稿。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "search",
      name: "搜索与无匹配恢复",
      section: "normal",
      condition: "五个演示模型可供筛选；超过四项时显示正式搜索控件。",
      steps: [
        "进入模型列表，搜索“不存在”。",
        "核对无匹配而当前模型未变。",
        "清空查询，选择Vision。",
      ],
      expected: "无匹配与没有配置模型区分；清除后恢复完整列表。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "read-failure",
      name: "读取失败与重试",
      section: "exception",
      condition: "模型目录处于error。",
      steps: ["打开模型入口查看失败。", "重新读取，选择有效模型。"],
      expected: "恢复动作属于模型菜单；失败不清空正文。",
      render: () => <HomeStoryExample scenario="model-error" />,
    },
    {
      id: "empty",
      name: "没有模型",
      section: "exception",
      condition: "未配置模型。",
      steps: [
        "打开模型入口查看空状态。",
        "点击设置模型入口，查看边界事件。",
        "尝试发送。",
      ],
      expected: "清楚说明前置条件；设置入口有回调，不能发送至不存在的模型。",
      render: () => <HomeStoryExample scenario="model-empty" />,
    },
    {
      id: "loading",
      name: "目录读取中",
      section: "states",
      condition: "模型列表等待演示解除。",
      steps: [
        "打开模型入口查看读取状态。",
        "按Alt+Shift+R完成等待，再选择模型。",
      ],
      expected: "加载不伪装空集合；完成后菜单可操作。",
      render: () => <HomeStoryExample scenario="model-pending" />,
    },
    {
      id: "long-name",
      name: "长模型名称",
      section: "states",
      condition: "显示名称长于常规情况。",
      steps: [
        "查看800px和390px完整工具栏。",
        "打开模型菜单，检查完整名称与操作区。",
      ],
      expected: "名称、权限、配置、发送不重叠；截断信息按需补全。",
      render: () => <HomeStoryExample scenario="model-long" />,
    },
  ],
  viewport: {
    width: 800,
    height: 680,
  },
} satisfies CatalogEntry
