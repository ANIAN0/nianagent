import type { CatalogEntry } from "../../../../ui-catalog/catalog-types"
import { ConversationIdleInputExample } from "../../../../ui-catalog/fixtures/conversation-idle-input-stories"

export default {
  id: "conversation-context",
  name: "查看上下文用量",
  order: 307,
  source: "src/features/conversation/composer/context-usage.tsx",
  composition: [
    "ContextUsage · src/features/conversation/composer/context-usage.tsx",
    "ComposerAuxiliaryBar · src/features/conversation/composer/composer-auxiliary-bar.tsx",
    "RunStatistics · src/features/conversation/composer/run-statistics.tsx",
    "ComposerPanelProvider · src/components/composer/composer-panel-context.tsx",
    "Button / Popover / Tooltip / Separator · src/components/ui",
    "LiveConversationView / useLiveConversation · src/features/conversation",
  ],
  group: "查看上下文用量",
  layer: "复合组件",
  stage: "content",
  pages: ["会话"],
  description:
    "输入卡下方居中显示运行统计、累计用量与缓存命中、上下文占用；分别查看详情及读数来源。",
  boundary:
    "只读取当前会话快照，不推算不存在的拆分、不触发模型调用。用量面板不提供压缩操作；未知读数不补零。",
  story: {
    goal: "了解当前上下文占用及数据可信范围，区分会话累计用量。",
    preconditions: [
      "已打开会话，宿主提供当前或已保存的上下文读数。",
      "估算、来源、历史恢复及观测时间来自同一会话快照。",
    ],
    result: "能判断读数是否当前、历史或待更新，关闭后继续原输入。",
  },
  standards: [
    {
      id: "context-dsh-surface",
      name: "DSH 入口与面板",
      rule: "参考 DSH StatsPills / ContextMeter：运行统计（轮数、步数及速度）、累计用量（紧凑token及缓存命中）、上下文百分比按此顺序居中，入口间距12px，共用22px高、12px/20px的Button insight圆形边角。14px动态细环、2px线宽、200ms上方提示；点击上方展开264px面板，8px间隔、12px视口避让。三个详情与模型浮层互斥，按下不位移、内侧焦点圈。",
      reason:
        "占用变化有直接视觉反馈；鼠标与键盘打开同一读数，浮层不挡住另一入口。",
      check:
        "打开、再次点击、Esc及外部点击；依次打开上下文、累计统计和模型，检查只保留一个输入浮层及原草稿。",
    },
    {
      id: "context-source-boundary",
      name: "正式数据与来源",
      rule: "Pi只提供总量估算，显示中性总量条，不补造系统、工具、消息拆分。~、Pi来源、观测时间和历史说明均保留，累计用量在独立统计面板。",
      reason: "DSH拥有拆分投影，Moon当前契约没有；展示需与正式宿主数据一致。",
      check:
        "核对3轮18步、27 token/s、278K token、缓存命中72%、45%与~28.8K / 64K。运行详情标记本轮估算速度，累计详情保留278200精确数值；恢复历史后显示<1%及历史说明。",
    },
    {
      id: "context-unknown-and-limits",
      name: "未知与数值边界",
      rule: "有效非负用量和正容量才显示常规入口；未知、待更新或非法数值不当0。有效0显示空环/空条，超容量比例限100%但保留原用量。压缩的进度与结果在会话内独立显示，不依赖用量入口。",
      reason:
        "隐藏无效读数沿用已确认设计；用量显示与压缩操作各自拥有状态，视觉比例不能冒充原始token计数。",
      check:
        "改为待更新或无读数，核对入口关闭且累计统计独立保留；检查有效0与超容量。",
    },
  ],
  inputs: [
    "ConversationSnapshot.context / contextState：用量、容量、估算来源、历史恢复、观测时间或未知原因。",
    "ConversationSnapshot.statistics：Pi分支轮数、步数、累计输入/输出/缓存/工具次数，以及已有本轮耗时和估算速度。",
  ],
  events: [
    "打开/关闭只改变当前输入浮层，不修改正文、材料或会话历史。",
    "快照更新直接替换所属读数；切换会话卸载旧面板，历史标记以宿主为准。",
  ],
  consumers: [
    "LiveConversationView · src/features/conversation/live-conversation-view.tsx",
  ],
  viewport: { width: 1000, height: 760 },
  states: [
    {
      id: "current-reading",
      name: "查看占用、来源与累计用量",
      section: "normal",
      condition:
        "隔离服务提供正式快照形状的3轮18步、本轮速度27.1 token/s、累计278200 token和45% Pi估算；正式会话组件从空稿开始。",
      expected:
        "三个入口居中且顺序与DSH一致，分别展开运行、累计和上下文详情；细环和总量条匹配45%，面板有~28.8K / 64K及来源，切换浮层与关闭保留草稿。",
      steps: [
        "输入下一稿，悬停上下文入口，再点击打开；阅读读数、来源和观测时间。",
        "按Esc关闭，依次点击运行统计和会话累计用量；核对轮数、步数、本轮估算速度、输入/输出和72%缓存命中，确认三个详情互斥。",
        "打开模型菜单再返回上下文；点击外部关闭，确认下一稿不变。",
        "用量详情只显示读数，关闭后继续编辑原稿。",
      ],
      render: () => <ConversationIdleInputExample scenario="context-usage" />,
    },
    {
      id: "unknown-reading",
      name: "用量未知与待更新",
      section: "exception",
      condition: "既有隔离服务可发布没有有效读数或等待更新的快照，不执行模型。",
      expected: "未知或待更新不显示0%；旧面板卸载，草稿及累计用量保留。",
      steps: [
        "打开上下文，再展开演示控制改为用量待更新；检查旧面板和比例入口消失。",
        "改为无对应读数，确认累计统计仍属于原会话，草稿仍可编辑。",
        "再发布当前读数，查看对应的上下文入口。",
      ],
      render: () => <ConversationIdleInputExample scenario="context-usage" />,
    },
    {
      id: "history-and-limits",
      name: "历史、零值、超容量与会话切换",
      section: "states",
      condition:
        "同一正式会话可从服务接收历史450 / 64000、有效零值和超容量68000 / 64000读数。",
      expected:
        "<1%不是0；历史来源可辨认，零值无实心弧和条，超容量限制视觉比例且保留68K。切换会话不继承原浮层和读数。",
      steps: [
        "在演示控制恢复历史读数，打开<1%入口，查看历史标记、保存时点和下一次回复后更新的说明。",
        "发布有效零读数再打开；确认0%有明确来源且没有填充段。",
        "发布超容量读数；核对100%与~68K / 64K，窄窗口内面板仍可阅读和关闭。",
        "保留下一稿，打开上下文并切到另一个会话；返回后原稿和原会话读数保留，旧浮层不自动打开。",
      ],
      render: () => <ConversationIdleInputExample scenario="context-usage" />,
    },
  ],
} satisfies CatalogEntry
