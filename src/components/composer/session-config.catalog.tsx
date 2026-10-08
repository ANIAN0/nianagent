import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { HomeStoryExample } from "../../../ui-catalog/fixtures/home-stories"

export default {
  id: "session-config",
  name: "修改会话配置",
  source: "src/components/composer/session-config.tsx",
  group: "修改会话配置",
  layer: "复合组件",
  order: 103,
  pages: ["首页"],
  stage: "content",
  description:
    "用户选择本次会话工具与AGENTS.md加载范围，应用确认后才更新草稿。",
  boundary:
    "示例直接复用完整 HomeComposer，服务、草稿和浏览器存储只存在预览内存。演示到首页 onSubmit 回调结束，不模拟路由成功或 Agent 回复，不修改对话页面。 管理扩展使用内存扩展服务，属于应用级配置；本轮不重新设计扩展页面。",
  story: {
    goal: "选择可用工具与AGENTS.md加载范围，核对对应文件路径后应用。",
    preconditions: [
      "当前工作目录与会话身份有效。",
      "演示目录含三项可用工具、一项依赖缺失工具及全局、目录指令路径。",
    ],
    result: "应用成功才更新草稿；取消保留原值；可用、已选和生效集合能区分。",
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
      id: "C2",
      name: "弹窗分区与对齐",
      rule: "会话配置12px圆角；标题、Tabs、工具筛选与列表、AGENTS.md范围与路径、底栏共用左右轴。管理扩展只在工具页Tab行右侧显示。",
      reason: "这是一项连续配置任务，搜索和列表不能各自带多层缩进。",
      check: "默认、无匹配、长列表检查左右边缘；Tabs上下间距与同类弹窗一致。",
    },
    {
      id: "C3",
      name: "工具表格与筛选",
      rule: "正式Table compact分选择、工具与用途、来源、操作四列，复选框与详情按行居中；名称13px/20px，说明与来源12px/18px。选择44px、来源80–112px、操作56px，单元格左右8px上下12px；长内容自然换行，行可增高。搜索Input compact和来源32px同高、14px/20px。筛选不清候选，已选计数为总选择；批量只改当前结果，清除只清查询。不可用可读详情、已选可取消但不能新增。",
      reason: "用户主要任务是选工具，详情不应增加多层嵌套障碍。",
      check:
        "宽窄窗口核四列/字号/多行原因；搜索、来源、批量、清除与详情返回后检查候选、滚动和焦点。",
    },
    {
      id: "C4",
      name: "修改与保存",
      rule: "取消不回写；应用在服务确认后更新；失败保留候选并原位恢复。管理扩展为完整文字次级动作，不截成难辨的入口。",
      reason: "会话候选与全局扩展配置有不同归属，必须能识别动作范围。",
      check: "查看session.apply/applied；取消无apply；管理扩展返回后候选保留。",
    },
    {
      id: "C5",
      name: "AGENTS.md范围与路径",
      rule: "AGENTS.md页使用FieldSet/RadioGroup三档竖排，Field/FieldLabel保持标准14px标签。选中项控制行和对应路径同属轻底面/边线区域，路径紧贴控制行并从标签文字起点缩进，13px/20px、间距12px；路径位于标签外，可选普通文字。选中区域按内容自然高度，只允许收缩；三控制行固定可达，长路径仅在自身滚动，不打开正文或跳转。不加载仅三个控制行，其他范围无文件时在选中项内保留必要空状态。",
      reason:
        "配置任务是选择加载范围；同名文件用真实路径辨认，文件内容由用户在IDE中查看和修改。",
      check:
        "完整首页宽窄/浅深主题检查选项与路径的从属、短内容自然高度、长路径滚动且三控制行/页脚可见；选择路径文本不得切Radio，键盘三档/取消应用/失败等待保持。无正文、快照、计数、普通重读或跳转。",
    },
  ],
  inputs: [
    "SessionCatalog:{tools,instructions,defaults}；tools包含available与原因，instructions的path/source用于范围和路径展示，content仅用于内部比较",
    "SessionConfiguration:{revision,toolIds,effectiveToolIds,unavailableToolIds,instructionScope,instructions}；instructions用于内部保存与差异判断，不向用户展示快照",
    "SessionConfig value来自输入草稿，弹窗维护独立候选；workspacePath与sessionId限定归属",
    "InstructionScopePicker接收value/instructions/onChange，保持服务顺序并只筛选对应范围的路径，不按文件名过滤；路径显示在选中项控制行外的普通文本区域",
    "ToolPicker按id派生当前tools的详情，backIfDetail仅实际从详情返回时报告true；canRestoreFocus表示工具页可见且控件未被saving/refreshing禁用",
  ],
  events: [
    "catalog/read读取；apply带版本和候选，成功后onChange回写",
    "关闭后重开读取当前目录；内容变化即允许明确应用，工具与范围不变也能保存新内容，不自动apply",
    "错误恢复和扩展保存返回复用load(true)，更新目录与保存基线，不apply、不清候选、页签或工具筛选",
    "新打开从工具页进入；切至AGENTS.md隐藏管理扩展，切回工具恢复原入口；工具详情Escape返回表格，工具列表及AGENTS.md的Escape关闭取消，扩展或保存租约优先保护",
    "进入工具详情聚焦返回按钮；返回保留查询、来源、滚动并聚焦原详情按钮，按钮消失则聚焦搜索；隐藏页/扩展或saving/refreshing期间暂存焦点恢复，实际可交互后才消费；目录刷新更新详情，已移除未选工具退出详情，已选失效工具显示当前恢复信息",
    "取消/分类切换不apply；扩展配置有独立服务，不归为会话工具保存",
  ],
  composition: [
    "SessionConfig / ToolPicker / InstructionScopePicker / Dialog / Tabs / InputGroup / Select / Table(Header/Body/Row/Head/Cell/CellDescription) / Checkbox / FieldSet / FieldLegend / Field / FieldLabel / RadioGroup / Button",
  ],
  consumers: ["首页与会话共用输入工具栏"],
  states: [
    {
      id: "apply-tools",
      name: "筛选工具并应用",
      section: "normal",
      condition: "已有默认read/edit；bash可选。",
      steps: [
        "打开会话配置。",
        "搜索Bash，勾选Bash，核对当前结果为1、总已选为3；点击清除工具搜索，核对焦点回输入及选择保留，再切换来源。",
        "展开一项详情，核对焦点在返回按钮；按Escape返回表格，核对原详情按钮焦点与滚动。",
        "点击应用，查看session.applied的工具集合。",
      ],
      expected:
        "筛选与清除不清空默认选择，四列对齐且详情可键盘返回；应用成功才回写，详情不改变选择。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "tool-table-long",
      name: "工具表格与长内容",
      section: "states",
      condition:
        "完整首页含19项工具，包含长英文名称、长来源、多行用途及不可用原因，初始read/edit已选。",
      steps: [
        "从首页打开配置，在常规及390px视口检查搜索14px/20px、四列表头、来源列与操作列、复选框和详情居中。",
        "滚动工具表格，点击长名称勾选，展开详情；核对完整名称与说明，按Escape返回原位置及按钮焦点。",
        "选择较长来源，核对弹层文字自然换行且不撑出视口；搜索检查工具并全选当前结果，核对总已选数包含隐藏的read/edit。",
        "点击清除工具搜索，核对只清查询并聚焦搜索；当前结果全不选，再恢复全部来源，核对隐藏选择保留。",
        "查看多行不可用原因及详情，尝试新增选择，核对不可用工具不能新增；选择可用工具并应用，再重开核对已保存集合。",
      ],
      expected:
        "长内容完整换行并增加行高，表格局部滚动，筛选/总数/批量/焦点与选择一致；来源和操作列不隐藏，标题与页脚始终可达，应用成功才保存。",
      render: () => <HomeStoryExample scenario="config-long-tools" />,
    },
    {
      id: "tool-detail-refresh",
      name: "工具详情刷新与移除",
      section: "normal",
      condition:
        "首页首次catalog为第1次，首次开配置为第2次；目录检查使用独有来源目录检查扩展，第3次读取更新正文及可用状态，第4次移除该工具和来源项。变化只在内存服务发生。",
      steps: [
        "从首页打开配置，勾选Bash；切AGENTS.md选择仅目录，再回工具，来源选目录检查扩展、搜索目录检查。",
        "打开未勾选的目录检查详情，核对版本1与返回按钮焦点；按Escape返回，再打开详情。",
        "点管理扩展，更改一项内存扩展设置并保存返回，触发第3次catalog；核对详情显示版本2和不可用原因，Bash及仅目录候选、查询/来源仍保留。",
        "再次打开管理扩展，更改设置并保存返回，触发第4次catalog；核对未选目录检查消失后返回原查询列表，等待刷新解除后搜索获得焦点，旧详情不复活；来源项已移除但trigger仍显示目录检查扩展，筛选保留且结果为0。",
        "清除查询并恢复全部来源后查看其他结果；切AGENTS.md核对仅目录候选；取消后重开，核对扩展更新没有自动保存本次会话候选。",
        "重置后改走已选分支：首次开配置勾选目录检查并看详情；扩展保存第3次读取后核对已选失效工具仍可取消，第4次移除后详情显示当前失效恢复信息，而不是版本1正文。返回列表、恢复全部来源并取消该工具，再明确应用可用候选。",
      ],
      expected:
        "读取后详情来自最新tools；未选工具移除退出且焦点可达，已选移除保留当前恢复入口。扩展保存返回不清筛选、候选或页签，不自动apply；详情Escape退一级，列表Escape关闭，保存/扩展保护保持。",
      render: () => <HomeStoryExample scenario="config-tool-changes" />,
    },
    {
      id: "instructions-cancel",
      name: "AGENTS.md范围与取消",
      section: "normal",
      condition: "有个人和目录指令。",
      steps: [
        "打开配置，切AGENTS.md，查看全局与目录控制行和路径属于同一轻底面，短路径按内容收紧，其他两个选项仍可见。",
        "用Radio或标签选择仅目录，核对目录路径随选中项移到其下方；用方向键切不加载，核对只剩三个控制行。",
        "恢复全局与目录并选中路径文字，核对没有切换Radio或打开文件。",
        "切回工具检查工具选择仍在。",
        "取消后重新打开，核对原范围。",
      ],
      expected:
        "选中范围与路径从属清楚，短内容不填满空白；路径可选择且不触发Radio，两类候选保持，取消不产生session.apply，原范围未变。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "reopen-instructions",
      name: "重开读取文件变化并应用",
      section: "normal",
      condition:
        "从未保存配置开始；首次应用后第一次重开只模拟目录文件正文变化，路径、工具和范围不变；再次重开模拟当前目录文件移除。",
      steps: [
        "从首页打开配置，勾选Bash并应用，实际保存首次配置。",
        "重新打开并切AGENTS.md，核对仍为全局与目录及原路径，没有正文、快照或重读入口。",
        "不改工具或范围，核对应用可用；查看demo.instructions.changed事件确认仅正文变更，再明确应用。",
        "再次重开，核对当前目录路径已移除，未自动产生session.apply。",
        "改为仅目录再取消，重开核对原全局与目录和Bash选择；取消未保存候选。",
        "重置后首次选择不加载并应用；重开时目录正文变化位于当前范围外，不改工具或范围时应用仍禁用。",
      ],
      expected:
        "关闭重开看到当前路径；所选范围内正文变化使应用可用，范围外变化不误启用，读取不自动保存，明确应用成功才更新配置，取消保持原工具与范围。",
      render: () => <HomeStoryExample scenario="config-instruction-changes" />,
    },
    {
      id: "manage-extensions",
      name: "管理扩展归属",
      section: "normal",
      condition: "扩展服务也使用内存替身。",
      steps: [
        "打开会话配置，搜索Bash并勾选，切换来源筛选。",
        "用键盘切AGENTS.md，核对管理扩展隐藏；选择仅目录，再切回工具。",
        "从工具页进入扩展配置，保存一项内存扩展设置后返回。",
        "核对工具页、搜索、来源和Bash候选仍保留，切AGENTS.md核对仅目录候选仍在。",
        "取消后重开，核对从工具页进入，原工具和范围未被扩展保存隐式应用。",
      ],
      expected:
        "管理扩展仅工具页可达，原位置和行为保持；扩展保存返回保留页签、筛选和会话候选，不隐式应用会话配置。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "read-failure",
      name: "配置读取失败",
      section: "exception",
      condition: "首页首次配置就绪；打开面板的读取失败。",
      steps: ["打开配置，查看原位失败。", "重新读取，调整工具再取消。"],
      expected: "有恢复、候选未被错误保存；不在输入框上方增加加载文案。",
      render: () => <HomeStoryExample scenario="config-read-error" />,
    },
    {
      id: "save-failure",
      name: "配置保存失败",
      section: "exception",
      condition: "首次apply失败，第二次可成功。",
      steps: [
        "勾选Bash并应用。",
        "查看失败后Bash候选仍在。",
        "切AGENTS.md并选择仅目录，核对错误反馈下路径在选中区域内滚动，三控制行和底部动作仍可用。",
        "点击读取当前会话已保存配置，核对Bash候选仍保留，且读取恢复没有产生新的session.apply。",
        "核对仅目录候选与当前页签仍保留；再次点击应用，查看session.applied和回写的工具集合与范围。",
      ],
      expected:
        "失败保留候选与原生效值；恢复只读取保存基线，不重发保存。候选保留后用户再次应用，确认成功才回写。",
      render: () => <HomeStoryExample scenario="config-save-error" />,
    },
    {
      id: "read-pending",
      name: "面板读取中",
      section: "states",
      condition: "打开面板后的读取待解除。",
      steps: [
        "打开配置查看等待布局。",
        "按Alt+Shift+R完成等待，查看工具并切AGENTS.md，核对三控制行及选中项对应路径。",
      ],
      expected:
        "标题和底部操作保持可见；等待在配置操作区，不出现在输入正文上方。",
      render: () => <HomeStoryExample scenario="config-read-pending" />,
    },
    {
      id: "save-pending",
      name: "应用等待",
      section: "states",
      condition: "写入待解除。",
      steps: [
        "切AGENTS.md，选择仅目录并应用。",
        "检查重复应用与离开约束，三控制行、选中区域和页脚保持可见。",
        "按Alt+Shift+R完成等待，核对已生效集合。",
      ],
      expected: "等待归属于应用操作，重复调用被阻止，成功才回写。",
      render: () => <HomeStoryExample scenario="config-save-pending" />,
    },
    {
      id: "instruction-paths",
      name: "长路径与三个加载范围",
      section: "states",
      condition:
        "未保存配置；个人、上级目录和当前目录有同名AGENTS.md，服务还返回CLAUDE.md，路径含较长中文目录与空格。",
      steps: [
        "从完整首页打开配置，切AGENTS.md，在常规与390×520窗口、浅深主题核对路径紧贴全局与目录控制行且与标签起点对齐，辨认同名完整路径及CLAUDE.md。",
        "滚动选中项内路径区域，核对三个控制行和页脚始终可见；选中并复制文字，核对不触发Radio，没有跳转或正文弹窗。",
        "切仅目录，核对全局路径消失且目录路径随选中项显示；用方向键切不加载，核对只剩三个控制行，没有额外说明。",
        "恢复全局与目录，切工具勾选Bash并应用；重开核对从工具页进入，再切AGENTS.md查看范围与路径并取消。",
      ],
      expected:
        "选中项与其真实路径直接对应；长路径可选择、自然换行且仅在所属区域滚动，三控制行与底栏可达，未选项不显示路径。无正文、快照、计数、普通重读或管理扩展入口。",
      render: () => <HomeStoryExample scenario="config-long-instructions" />,
    },
    {
      id: "no-instructions",
      name: "无指令与不可用工具",
      section: "states",
      condition: "无指令；PowerShell依赖缺失。",
      steps: [
        "切AGENTS.md，在全局与目录、仅目录核对必要无文件空状态随选中项显示，区域按内容收紧；选择不加载，核对只剩三个控制行，没有额外空说明。",
        "切工具查看PowerShell原因并尝试勾选。",
        "选择其他可用工具并应用。",
      ],
      expected: "空指令不冒充读取失败；不可用项有原因且不能加入有效工具集合。",
      render: () => <HomeStoryExample scenario="config-no-instructions" />,
    },
  ],
  viewport: {
    width: 800,
    height: 680,
  },
} satisfies CatalogEntry
