import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { HomeStoryExample } from "../../../ui-catalog/fixtures/home-stories"

export default {
  id: "skill-call",
  name: "输入指定skill的消息",
  source: "src/features/home/home-composer.tsx",
  group: "输入指定skill的消息",
  layer: "复合组件",
  order: 105,
  pages: ["首页"],
  stage: "content",
  description: "从候选补全消息开头的 /skill:name，再编辑本次任务。",
  boundary:
    "直接复用完整 HomeComposer，服务、草稿与浏览器存储在隔离预览内存中。Skill 只补全普通文字，不准备材料或拼入 Skill 正文。演示到前端 onSubmit 回调结束；正式空闲发送已接 Pi 公开 prompt 默认 Skill 解析，实际宿主加载与执行须在正式首页另行验收，不能由本演示证明。",
  story: {
    goal: "在消息开头写一个 Skill 名称，并完整表达本次任务。",
    preconditions: [
      "正常例从空正文开始，目录有 review 与 plan 的名称和用途。",
      "手打完整名称不依赖候选目录；文件与图片仍使用原材料流程。",
    ],
    result:
      "候选与手打得到相同普通正文；改选保留参数，提交不携带 Skill 材料身份。",
  },
  standards: [
    {
      id: "S1",
      name: "普通正文补全",
      rule: "选择只插入或替换 leading /skill:name，保留其后参数。Skill 不创建材料身份、原子节点、准备状态或状态弹窗。手打完整非空名称，包括目录没有的名称，遵循同样正文语义。句内及第二个 Skill 保留普通文字，Moon 不强制加载。",
      reason: "候选帮助输入名称，不改变用户文字的归属或依赖。",
      check: "选择、手打、改选、删除与撤销后核对正文和 home.submit。",
    },
    {
      id: "S2",
      name: "候选与命令边界",
      rule: "leading / 展示已适配命令与 Skill，/skill: 只筛 Skill；句内不打开 Skill 候选。加号改选保参数，选后光标位于分隔空白之后，可直接编辑参数。普通命令保持现有校验；改成 Skill 后清除失配的扩展命令身份。",
      reason: "选择名称不应偷偷追加另一项调用或执行原来的扩展命令。",
      check: "先选 echo，再用加号选 Skill；核对完整文字及 command 为空。",
    },
    {
      id: "S3",
      name: "读取与旧草稿",
      rule: "候选保留名称、用途、搜索、读取失败重试及等待/无匹配 Enter 保护。裸 /skill: 不能提交；关闭候选后完整名称可以提交。可编辑旧稿只移除 Skill metadata，保留正文和非 Skill 材料；不改不可变原提交及签名。",
      reason: "候选读取失败不能成为完整普通文字的准备门禁，也不能损失旧稿。",
      check: "失败、等待、空目录、旧稿文件图片与长名称分别从完整输入区操作。",
    },
  ],
  inputs: [
    "MaterialCatalog.skills 的名称、用途与搜索文本，仅用于候选",
    "普通 /skill:name 与原文参数；HomeDraft 的非 Skill 材料保留",
    "原命令校验、文件图片准备和模型兼容规则保持现有行为",
  ],
  events: [
    "候选选择只变更正文；不调用 Skill material.prepare",
    "正文改选或手改清除失配 extension command 身份",
    "onSubmit 保留完整文字和非 Skill 材料，不附加 Skill metadata",
  ],
  composition: [
    "HomeComposer / PromptInput / ComposerEditor / MaterialPicker / SelectedMaterials",
  ],
  consumers: ["首页输入区", "会话共用正文门禁与候选"],
  states: [
    {
      id: "choose-parameters",
      name: "选择 Skill 并输入参数",
      section: "normal",
      condition: "空稿，review 与 plan 可搜索。",
      steps: [
        "输入 /，搜索用途或名称并选择 review。",
        "立即输入“检查这次首页改动”，无需等待准备。",
        "发送，展开“演示数据与事件”查看 home.submit。",
      ],
      expected:
        "正文为 /skill:review 加原文参数；无 Skill prepare 调用或材料身份。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "change-selection",
      name: "改选保留参数",
      section: "normal",
      condition: "从空稿实际选择 Skill。",
      steps: [
        "选择 review 并输入参数。",
        "从加号选择 Skill，再选择 plan；直接继续编辑参数。",
        "核对仅 leading 名称改变；发送查看完整正文。",
      ],
      expected: "参数与其分隔空白保留，不追加多个 Skill；光标不粘在名称末尾。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "remove-undo",
      name: "删除与撤销普通文字",
      section: "normal",
      condition: "从空稿选择并输入参数。",
      steps: [
        "选择 review，输入参数。",
        "选中名称的部分字符删除，再 Ctrl+Z 撤销。",
        "删除整个前缀，再撤销；Escape 关闭候选后发送。",
      ],
      expected: "Skill 可按普通字符编辑和撤销，无原子引用或材料恢复依赖。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "typed-text",
      name: "手打名称与句内文字",
      section: "normal",
      condition: "空稿，不使用候选选择。",
      steps: [
        "手打 /skill:未知.name+v2 检查当前任务，发送查看正文。",
        "重置后输入“解释句内 /skill:review 和 /usr”，检查无 Skill 候选并发送。",
        "重置后输入 /skill:review 参数 /skill:plan 更多文字，再发送。",
      ],
      expected:
        "完整未知名称不依赖目录；句内和第二个前缀原文保留，无强制加载身份。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "commands",
      name: "扩展命令改为 Skill",
      section: "normal",
      condition: "含已注册 echo 与首页不可用 compact。",
      steps: [
        "输入 /，检查 compact 不可确认，选择 echo 并输入参数。",
        "从加号选 review；发送核对 command 为空且参数保留。",
        "重置后重复选择 echo，手改 leading 为 /skill:review 再发送。",
      ],
      expected:
        "普通命令能力与校验保留；选择或手改 Skill 均不携带原 echo 身份。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "legacy-draft",
      name: "旧 Skill 草稿保留文件图片",
      section: "normal",
      condition:
        "预置迁移边界：旧稿有完整正文、失败 Skill metadata、文件和图片。",
      steps: [
        "核对 leading 与句内文字、README 文件引用和参考图片完整。",
        "编辑原稿参数，预览文件与图片，再发送。",
        "展开事件核对 home.submit：原正文与非 Skill 材料保留。",
      ],
      expected:
        "只去除旧 Skill metadata；旧失败不阻塞，不删除正文、文件或图片。",
      render: () => <HomeStoryExample scenario="skill-legacy-draft" />,
    },
    {
      id: "catalog-failure",
      name: "候选读取失败与重试",
      section: "exception",
      condition: "首次资源读取失败。",
      steps: [
        "输入 /skill:，读取失败时按 Enter，核对未提交。",
        "点击原位重试；不用再点正文，按 Down/Enter 选择 Skill，再输入参数并发送。",
        "重置后从加号选择 Skill，重试后在搜索框直接用 Down/Enter 选择。",
      ],
      expected: "失败保留输入，重试恢复候选；选择不进入 Skill 准备流程。",
      render: () => <HomeStoryExample scenario="resource-error" />,
    },
    {
      id: "unmatched",
      name: "空候选与完整未知名称",
      section: "states",
      condition: "Skill 目录为空；compact 仍不可用。",
      steps: [
        "输入 /skill:，在空候选中按 Enter，再 Escape 关闭后按 Enter。",
        "补全为 /skill:自定义名称 并输入参数，发送查看正文。",
      ],
      expected: "裸前缀和开启的空候选不误提交；完整名称不受目录为空影响。",
      render: () => <HomeStoryExample scenario="resource-empty" />,
    },
    {
      id: "reading",
      name: "候选等待",
      section: "states",
      condition: "资源读取等待手动完成。",
      steps: [
        "输入 /skill:，读取中按 Enter。",
        "按 Alt+Shift+R 完成等待，选择 review 并输入参数、发送。",
      ],
      expected: "读取中 Enter 不提交；读取完成后直接补全普通文字。",
      render: () => <HomeStoryExample scenario="resource-pending" />,
    },
    {
      id: "long-name",
      name: "长名称与窄窗候选",
      section: "states",
      condition: "空稿，目录含长 Skill 名称；可设置 390px 视口。",
      steps: [
        "输入 /，搜索 accessibility，查看名称、用途与截断补全。",
        "选择候选，立即输入参数并发送。",
      ],
      expected: "候选与操作可达，提交名称和参数完整，无长名产品特例。",
      render: () => <HomeStoryExample scenario="skill-long" />,
    },
  ],
  viewport: { width: 800, height: 680 },
} satisfies CatalogEntry
