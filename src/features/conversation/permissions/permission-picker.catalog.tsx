import type { CatalogEntry } from "../../../../ui-catalog/catalog-types"
import { HomeStoryExample } from "../../../../ui-catalog/fixtures/home-stories"

export default {
  id: "permission-picker",
  name: "设置权限",
  source: "src/features/conversation/permissions/permission-picker.tsx",
  group: "设置权限",
  layer: "复合组件",
  order: 101,
  pages: ["首页"],
  stage: "content",
  description: "用户设置本次会话允许的操作范围；完全权限需要明确确认。",
  boundary:
    "示例直接复用完整 HomeComposer，服务、草稿和浏览器存储只存在预览内存。演示到首页 onSubmit 回调结束，不模拟路由成功或 Agent 回复，不修改对话页面。 本故事不新增自动审核选项，不进入执行审批流程。",
  story: {
    goal: "在发送前明确哪些操作可以执行，并知道高权限选择是否已生效。",
    preconditions: [
      "当前工作目录和内存会话身份已就绪。",
      "默认权限为工作区内修改。",
    ],
    result: "读取到的当前权限与入口、菜单标记一致；失败或取消保留原权限。",
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
      rule: "完整可读入口和短选项不增加重复Tooltip；只有图标、实际截断名称或不可用原因才补全。提示沿项目Tooltip规格。",
      reason: "浮窗要补缺失信息；重复标签只制造遮挡和多套风格。",
      check: "关闭与展开分别检查，不出现HTML title、双重浮窗或常驻正文说明。",
    },
    {
      id: "P3",
      name: "模式与风险",
      rule: "只有仅可查看、工作区内修改、完全权限三档；选项单行图标+名称+右侧选中标记，上方展开；完全权限沿现有风险确认。",
      reason: "三档对应已接入的工具权限；额外选项不能凭参考页面外观添加。",
      check: "普通模式选择立即保存；完全权限取消不改值，勾选确认后才能应用。",
    },
    {
      id: "P4",
      name: "写入完成才回显",
      rule: "读取、保存期间不能把候选当生效；失败原位恢复，当前值保留。",
      reason: "权限决定执行边界，必须区分待保存和已生效。",
      check: "查看permission.set/saved事件与入口标记，失败前后原值一致。",
    },
  ],
  inputs: [
    "PermissionService.read(sessionId) → {mode,revision}",
    "PermissionService.set(current,mode) 使用当前版本；三档模式固定",
  ],
  events: [
    "read读取后入口显示当前模式",
    "set成功才回写当前模式；风险取消不调用set",
    "reply审批接口在首页示例禁止调用",
  ],
  composition: [
    "SessionPermissionControl / PermissionPicker / DropdownMenu / Dialog / Checkbox",
  ],
  consumers: ["首页输入工具栏"],
  states: [
    {
      id: "change-mode",
      name: "切换普通权限",
      section: "normal",
      condition: "当前工作区内修改。",
      steps: [
        "打开权限菜单选择仅可查看。",
        "关闭后核对入口与再次打开的选中标记。",
        "再改回工作区内修改，查看保存事件。",
      ],
      expected: "标签、标记、已保存模式一致；完整短选项没有重复Tooltip。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "risk-confirm",
      name: "完全权限确认与取消",
      section: "normal",
      condition: "选择完全权限会进入现有确认弹窗。",
      steps: [
        "选择完全权限，先取消。",
        "核对权限仍为工作区内修改且没有完全权限保存事件。",
        "再次选择，勾选风险确认并应用。",
      ],
      expected: "取消不写；确认前不可应用，确认后才显示完全权限。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "read-failure",
      name: "读取失败恢复",
      section: "exception",
      condition: "权限首次读取失败。",
      steps: [
        "入口显示权限未读取，正文不被常驻浮层覆盖。点击入口查看原因及重新读取。",
        "重新读取，再打开菜单。",
      ],
      expected: "不猜测权限；重读后恢复真实模式，正文保留。",
      render: () => <HomeStoryExample scenario="permission-read-error" />,
    },
    {
      id: "save-failure",
      name: "保存失败保留原权限",
      section: "exception",
      condition: "首次保存失败，第二次恢复。",
      steps: [
        "选择仅可查看，入口显示权限待核对；点击查看失败原因。",
        "核对原工作区内修改仍有效。",
        "先重新读取原权限，再选择仅可查看并查看保存事件。",
      ],
      expected: "失败不伪装选中成功，重试后才更新模式。",
      render: () => <HomeStoryExample scenario="permission-set-error" />,
    },
    {
      id: "read-pending",
      name: "读取等待",
      section: "states",
      condition: "权限读取待解除。",
      steps: [
        "检查入口等待状态和正文仍可编辑。",
        "按Alt+Shift+R完成等待，再打开菜单。",
      ],
      expected:
        "入口显示读取权限…，可访问名称为正在读取会话权限；不显示未经读取的生效值，恢复后模式准确。",
      render: () => <HomeStoryExample scenario="permission-read-pending" />,
    },
    {
      id: "save-pending",
      name: "保存等待",
      section: "states",
      condition: "权限保存待解除。",
      steps: [
        "选择仅可查看。",
        "尝试重复操作，检查等待反馈。",
        "按Alt+Shift+R完成等待，核对模式。",
      ],
      expected:
        "入口显示正在保存权限…，可访问名称为正在保存会话权限；保持忙碌且不可重复操作，完成后才回显。",
      render: () => <HomeStoryExample scenario="permission-set-pending" />,
    },
  ],
  viewport: {
    width: 800,
    height: 680,
  },
} satisfies CatalogEntry
