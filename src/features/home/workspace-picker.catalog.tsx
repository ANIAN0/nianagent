import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { HomeStoryExample } from "../../../ui-catalog/fixtures/home-stories"

export default {
  id: "workspace-picker",
  name: "选择工作目录",
  source: "src/features/home/workspace-picker.tsx",
  group: "选择工作目录",
  layer: "复合组件",
  order: 100,
  pages: ["首页"],
  stage: "content",
  description: "用户选择本次工作的目录，并在切换后继续该目录的草稿。",
  boundary:
    "示例直接复用完整 HomeComposer，服务、草稿和浏览器存储只存在预览内存。演示到首页 onSubmit 回调结束，不模拟路由成功或 Agent 回复，不修改对话页面。 本故事只模拟目录选择服务，不打开操作系统选择器；产品原生选目录未在浏览器验证。",
  story: {
    goal: "确定这次工作发生在哪个目录，切换时保留各目录的独立草稿。",
    preconditions: [
      "已有两个演示目录；也提供无目录和失效目录。",
      "首页尚未开始发送，可切换工作目录。",
    ],
    result:
      "当前目录、会话配置和后续材料查询归属一致；取消选择保留原目录及草稿。",
  },
  standards: [
    {
      id: "W1",
      name: "入口位置与信息",
      rule: "目录入口在输入卡上方左对齐；名称是主信息，完整路径只在必要说明中出现。菜单保留选中标记和添加工作区入口。",
      reason:
        "目录影响本次所有输入；放在输入之前便于确认，重复路径不能增加识别价值。",
      check: "检查当前名称、选中项、长名和输入卡左轴；不常驻重复完整路径。",
    },
    {
      id: "W2",
      name: "切换的数据边界",
      rule: "切换成功才更新当前目录，恢复该目录草稿；材料、配置和权限归属新会话身份。取消或失败不覆盖旧草稿。",
      reason: "跨目录的文件和输入不能误用；先清空再猜测成功会丢失工作。",
      check:
        "在moon输入文字，切notes后输入另一段，再切回moon；查看目录和服务事件。",
    },
    {
      id: "W3",
      name: "等待与恢复",
      rule: "等待禁用重复选择；失效目录保留名称和具体原因，读取失败提供重读。列表读取成功且为空时，点击入口直接选择目录，不先展开菜单；取消或选择失败后可以再次选择。",
      reason: "空、失效和读取失败对应不同恢复路径。",
      check: "分别打开无目录、失败、失效和等待例；恢复后原输入仍在。",
    },
  ],
  inputs: [
    "workspaces:{id,name,path,available,unavailableReason}[]；id 稳定，路径归目录",
    "initialDraft.workspaceId；draftStore.read/write 分别管理目录草稿",
  ],
  events: [
    "onWorkspaceSelect(id,signal) 完成后才切换；signal取消旧请求",
    "onChooseWorkspace(signal) 返回Workspace或null；null不写",
    "onWorkspaceAdd 通知目录新增；HomeComposer更新当前输入归属",
  ],
  composition: [
    "WorkspacePicker / DropdownMenu / RecoveryAction / HomeComposer",
  ],
  consumers: ["首页输入区"],
  states: [
    {
      id: "switch-drafts",
      name: "选择与切换草稿",
      section: "normal",
      condition: "已有 moon / notes，正文为空。",
      steps: [
        "在正文输入“moon任务”。",
        "打开目录菜单选择 notes，输入“notes任务”。",
        "切回 moon，核对原正文。",
        "打开演示数据与事件，核对两次目录选择的归属。",
      ],
      expected:
        "切换成功才变目录；各目录草稿独立，moon原正文恢复，无材料跨目录混用。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "add-directory",
      name: "添加工作目录",
      section: "normal",
      condition: "添加返回演示 project；不打开系统选择器。",
      steps: [
        "打开目录菜单，选择“添加工作区…”。",
        "等待返回 project，检查当前目录。",
        "输入文字，确认查询和配置事件使用project路径。",
      ],
      expected: "新目录加入且成为当前目录；输入可编辑，配置归新目录。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "choose-cancel",
      name: "取消添加",
      section: "exception",
      condition: "目录选择服务返回null。",
      steps: [
        "先输入一段正文。",
        "打开目录菜单添加工作区。",
        "等待取消返回，核对目录与文字。",
      ],
      expected: "取消不添加目录、不改变正文、不显示失败。",
      render: () => <HomeStoryExample scenario="workspace-cancel" />,
    },
    {
      id: "read-error",
      name: "读取失败与重读",
      section: "exception",
      condition: "初次目录列表读取失败。",
      steps: [
        "查看目录入口的失败反馈。",
        "执行重新读取。",
        "选择 notes 并继续输入。",
      ],
      expected: "原位恢复，目录可选且正文未被错误清空。",
      render: () => <HomeStoryExample scenario="workspace-error" />,
    },
    {
      id: "unavailable",
      name: "目录不可用",
      section: "exception",
      condition: "当前moon失效，notes可用。",
      steps: [
        "展开目录，查看moon不可用原因。",
        "尝试发送，确认无法使用失效目录。",
        "改选notes并输入文字。",
      ],
      expected: "失效项不冒充可用；改选后恢复输入和发送条件。",
      render: () => <HomeStoryExample scenario="workspace-unavailable" />,
    },
    {
      id: "empty",
      name: "无工作目录",
      section: "states",
      condition: "目录列表已读取成功且为空。",
      steps: [
        "点击目录入口，确认直接开始选择，不出现添加菜单。",
        "确认project加入，再次点击入口，检查已有目录菜单。",
        "重置示例，分别用Enter和空格激活入口，检查每次只有一条workspace.choose事件。",
      ],
      expected:
        "只有用户激活才开始选择，鼠标和键盘均只调用一次；成功添加后恢复已有目录菜单。",
      render: () => <HomeStoryExample scenario="workspace-empty" />,
    },
    {
      id: "empty-cancel",
      name: "空目录取消后重选",
      section: "exception",
      condition: "列表读取成功且为空，目录选择服务返回null。",
      steps: [
        "用Tab聚焦目录入口，按Enter选择，等待取消返回。",
        "不重新点击或Tab，直接按空格再次选择；检查两次选择均直接调用且没有菜单。",
        "重置后再次选择，等待期间主动移焦其他控件，确认取消后不会抢回焦点。",
      ],
      expected:
        "取消不添加目录、不报错；未主动移焦时焦点回到入口，可连续键盘重选，每次激活只调用一次。",
      render: () => <HomeStoryExample scenario="workspace-empty-cancel" />,
    },
    {
      id: "empty-choose-error",
      name: "空目录选择失败后重选",
      section: "exception",
      condition: "空列表首次选择失败，第二次返回project。",
      steps: [
        "点击目录入口，查看选择失败提示。",
        "再次点击目录入口，确认直接重选并加入project。",
      ],
      expected: "选择失败保留重试能力；入口不因本次选择错误永久退回菜单。",
      render: () => (
        <HomeStoryExample scenario="workspace-empty-choose-error" />
      ),
    },
    {
      id: "empty-read-error",
      name: "空列表读取失败",
      section: "exception",
      condition: "没有可用目录数据且读取失败，重读成功后列表仍为空。",
      steps: [
        "点击目录入口，确认保留菜单且未直接调用选择。",
        "关闭菜单，点击重新读取目录。",
        "再次点击目录入口，确认这次直接选择project。",
      ],
      expected: "读取失败不当作已确认空列表；重读成功后才启用直达。",
      render: () => <HomeStoryExample scenario="workspace-empty-read-error" />,
    },
    {
      id: "empty-loading",
      name: "空列表读取中",
      section: "states",
      condition: "尚无目录数据，读取仍在等待。",
      steps: [
        "检查目录入口禁用，尝试点击不调用选择。",
        "按Alt+Shift+R完成等待，检查未自动打开选择。",
        "点击目录入口，确认直接选择project。",
      ],
      expected: "读取中不触发选择；读取完成后等待用户激活，不自动弹窗。",
      render: () => <HomeStoryExample scenario="workspace-empty-pending" />,
    },
    {
      id: "loading",
      name: "读取中",
      section: "states",
      condition: "目录读取状态等待演示解除。",
      steps: [
        "查看等待和重复选择约束。",
        "按Alt+Shift+R按Alt+Shift+R完成等待，保持原操作焦点。",
        "展开目录并选择。",
      ],
      expected: "等待只表达读取；解除后可操作，没有重复请求。",
      render: () => <HomeStoryExample scenario="workspace-pending" />,
    },
    {
      id: "long-name",
      name: "长目录名",
      section: "states",
      condition: "目录名明显超过常规长度。",
      steps: [
        "在800px和390px预览检查名称。",
        "打开菜单查看完整来源。",
        "继续编辑正文并打开其他入口。",
      ],
      expected:
        "名称收缩不覆盖其他控件；缺失的完整信息可读，输入工具栏仍可达。",
      render: () => <HomeStoryExample scenario="workspace-long" />,
    },
  ],
  viewport: {
    width: 800,
    height: 680,
  },
} satisfies CatalogEntry
