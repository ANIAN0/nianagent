---
version: alpha
name: Moon
description: Moon 界面的色彩、文字、图标、布局与交互状态规范。
colors:
  background: "#f8f9fb"
  foreground: "#17202f"
  popover: "#ffffff"
  popover-foreground: "#17202f"
  primary: "#4176e6"
  primary-strong: "#3568d4"
  primary-foreground: "#ffffff"
  secondary: "#e9edf4"
  secondary-foreground: "#2a3343"
  muted: "#e9edf4"
  muted-foreground: "#5b6574"
  accent: "#e9eef7"
  accent-foreground: "#2a3343"
  destructive: "oklch(0.577 0.245 27.325)"
  sidebar: "#f9fafb"
  sidebar-foreground: "#17202f"
typography:
  headline:
    fontFamily: "'Source Han Sans SC', sans-serif"
    fontSize: 26px
    fontWeight: 500
    lineHeight: 32px
  title-lg:
    fontFamily: "'Source Han Sans SC', sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.4
  title-md:
    fontFamily: "'Source Han Sans SC', sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 24px
  body:
    fontFamily: "'Source Han Sans SC', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 21px
  caption:
    fontFamily: "'Source Han Sans SC', sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.7
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  composer: 16px
  dialog: 24px
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  control-height: 32px
components:
  surface:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    typography: '{typography.body}'
  sidebar:
    backgroundColor: '{colors.sidebar}'
    textColor: '{colors.sidebar-foreground}'
  description:
    textColor: '{colors.muted-foreground}'
    typography: '{typography.caption}'
  button-primary:
    backgroundColor: '{colors.primary-strong}'
    textColor: '{colors.primary-foreground}'
    rounded: '{rounded.lg}'
    height: 32px
  button-primary-hover:
    backgroundColor: 'color-mix(in oklab, #3568d4 90%, transparent)'
  button-outline:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    height: 32px
  button-ghost-hover:
    backgroundColor: '{colors.muted}'
    textColor: '{colors.foreground}'
  button-destructive:
    textColor: '{colors.destructive}'
  input-field:
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    height: 32px
  menu-item-focus:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.accent-foreground}'
    rounded: '{rounded.md}'
  selected-item:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.secondary-foreground}'
  popover:
    backgroundColor: '{colors.popover}'
    textColor: '{colors.popover-foreground}'
    rounded: '{rounded.lg}'
  dialog:
    backgroundColor: '{colors.popover}'
    textColor: '{colors.popover-foreground}'
    rounded: '{rounded.xl}'
    padding: 16px
  composer:
    backgroundColor: '{colors.popover}'
    rounded: '{rounded.composer}'
  material-chip:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.secondary-foreground}'
    rounded: '{rounded.full}'
---

## Overview

本规范定义 Moon 页面与组件共用的视觉语言。上方 token 记录浅色主题默认值；深色主题的替换值和配置入口见 Customization。字体、图标、状态表达和尺寸规则在两种主题中保持一致。

- **可辨认的状态。** 悬停、选中、展开、焦点和禁用分别表达；展开目录不等于选中目录，焦点不等于当前项目。
- **清楚的阅读层级。** 正文、操作标签与辅助说明使用固定文字角色；标题靠字号和字重区分，状态不只靠颜色表达。
- **可复用的尺寸。** 同类控件采用相同高度、圆角与图标尺寸；组件组合通过间距建立归属，不逐个页面另造控件样式。

## Colors

主题强调色为 **action-blue `#4176e6`**，沿用原型的主动作、勾选、标签指示线与焦点色；深色对应 `#6c9aef`。空白工作台使用冷灰 `#f8f9fb`，输入卡和浮层使用白色，侧栏使用原型 DSH 导航底色 `#f9fafb`。色彩分为内容、表面、操作与状态四类。`primary` 是操作强调色，`secondary` 是低强调选择面，二者不承担成功或错误语义。

| 角色 | Token | 使用规则 |
|---|---|---|
| 内容底面 | background / foreground | 页面画布底色及正文；输入卡另用 card / card-foreground |
| 导航底面 | sidebar / sidebar-foreground | 导航区域；不因展开分组而整组着色 |
| 浮层 | popover / popover-foreground | 菜单、选择列表和对话框；浮层独立于下层内容 |
| 辅助内容 | muted / muted-foreground | 弱化表面和补充说明；关键操作名称仍需可读 |
| 主操作 | primary / primary-foreground | 同一操作组内的主要动作，前景和背景成对使用 |
| 选中 | secondary / secondary-foreground | 已选项目；同时提供选中语义或标记 |
| 悬停与键盘定位 | accent / accent-foreground | 菜单项焦点；不代替持久选中标记 |
| 边界 | border / input | 容器分隔与输入控件边界，默认 1px |
| 焦点 | ring | 键盘焦点轮廓，沿用控件的 3px、50% 透明度外环 |
| 错误或危险 | destructive | 同时配合文字、图标或无效状态，不能仅改文字颜色 |

边框与焦点值在 Customization 表中按 CSS token 记录；YAML 组件字段没有 borderColor，因此不把边框伪装成背景属性。

`primary-strong` 采用原型的深一级蓝色 `#3568d4`，用于带文字的实心按钮；这是为修正原型 `#4176e6` 配白色小字仅 4.23:1 的对比度。发送箭头、焦点、勾选仍沿用 `primary`，不改变主题色。

引用语义变量，不在页面中写白色、黑色或主题灰值。hover 使用对应变体的混色规则，disabled 使用控件自身的透明度，不另建一套灰色色板。

## Typography

**字体统一使用本地思源黑体（Source Han Sans SC）**，包括中文、拉丁字母、数字、控件、文档及代码展示。字体文件为 Adobe 发布的 2.005 可变 WOFF2；使用 250–900 字重轴，界面主要使用 400、500 和 600。正常显示不依赖用户系统安装字体，也不向字体 CDN 发请求。

| 角色 | 字号 / 字重 / 行高 | 使用范围 |
|---|---|---|
| headline | 26px / 500 / 32px | 页面主标题 |
| title-lg | 24px / 600 / 1.4 | 文档或大区块标题 |
| title-md | 16px / 600 / 24px | 区块标题；侧栏品牌使用 18px / 600 / 24px |
| body | 14px / 400 / 21px | 正文、选择项和常规说明 |
| caption | 12px / 400 / 1.7 | 补充说明、来源、预期行为 |

操作标签可用 500 字重；相邻同级标签保持一致。小尺寸基础控件保留其尺寸变体：`sm` Button 的 12.8px、`xs` 的 12px；目录和会话行使用 13px。文档参数、路径和源码可在 11–13px 范围内降低密度，但不换另一套字体。

长标题单行截断时保留完整名称的可访问入口；说明与路径允许换行；源码长行在代码区滚动。不要通过逐项缩小字号解决内容过长。

字体定义位于 `src/index.css` 的 `@font-face`，`--font-sans`、`--font-heading` 和 `--font-mono` 共用该字体。资源和许可证位于 `public/fonts/source-han-sans/`；三个 HTML 入口预加载同一文件。

## Layout

间距以 4px 为基础，组内使用 4–8px，内容块使用 16px，章节使用 24–32px。按钮、选择器和单行输入的常规高度统一为 32px；紧凑变体为 24px 或 28px。既有基础控件的图标与边框补偿间距保留在控件内部，不扩散为页面间距规则。

容器边缘、文本起点和同行操作共用对齐线。标签靠近其控制对象，反馈靠近触发区域。可滚动区域只承担自己的内容，不用多层固定高度制造空白。

首页继承原型工作台的具体尺寸：

| 区域 | 尺寸与行为 |
|---|---|
| 桌面侧栏 | 默认 280px，允许 240–360px 调整；收起后保留 56px 图标列 |
| 品牌 / 主导航 | 品牌区 60px；新建会话 38px；导航行 36px；工作区标题 32px |
| 工作输入区 | `min(calc(100% - 64px), 880px)`，垂直居中，底部留 32px；标题下 12px |
| 目录入口 | 卡片外左对齐，高 28px；与输入卡间隔 12px |
| 输入卡 | 16px 圆角，文本至少 52px，正文 15px/24px；工具栏为材料 / 模型与思考 / 配置 / 发送 |
| 模型面板 | 288px 宽且不超过视口减24px；根项与选项至少40px，长名换行；连接分组，模型ID次级显示；两级面板，确认后关闭，尾部16px Check固定且不收缩 |
| 会话配置 | 600px × 500px，上限 `100dvh - 32px`；24px 圆角和内容轴；底栏 16px × 24px，按钮宽 72px |
| 指令选择 | 连续三行，最小 56px；组圆角 14px，行间细分隔 |
| 窄屏 | 小于 768px 使用导航抽屉，输入区左右各 16px；工具栏小于 384px 时配置保留图标与可访问名称；长模型名截断 |
| 短屏 | 高度不大于 600px，输入区顶留 72px，纵向滚动保留全部操作 |

页面不新增顶栏、副标题或常驻演示说明；模拟反馈只在触发对应操作后显示。文档多栏在窄屏切换面板，不缩放整张页面。

## Elevation & Depth

层级优先用表面颜色与 1px 边界表达。输入组合使用 `shadow-sm`：`0 1px 3px 0 rgb(0 0 0 / 10%), 0 1px 2px -1px rgb(0 0 0 / 10%)`。菜单和选择列表使用 `shadow-md`：`0 4px 6px -1px rgb(0 0 0 / 10%), 0 2px 4px -2px rgb(0 0 0 / 10%)`。

对话框使用 `popover` 表面、`foreground/10` 的 1px 外环和 `black/30` 遮罩。浮层定位、层级和焦点管理由基础组件负责，页面不另设随意的遮罩或 z-index。

普通状态过渡沿用 150ms；菜单、选择列表和对话框进入/离开使用 100ms。减少动态效果开启时将动画和过渡降至 0.01ms，并取消平滑滚动。动效不作为状态的唯一提示。

## Shapes

基础圆角 `--radius` 为 8px；尺寸 token 明确定义为 4 / 6 / 8 / 12 / 16 / 24 / 32px，对应 sm / md / lg / xl / 2xl / 3xl / 4xl：

- 常规控件使用 8px；导航行与模型面板使用 12px。
- 菜单项和紧凑控件使用 6px；小尺寸变体按自身定义处理。
- 通用对话框使用 12px；首页会话配置使用 24px，输入组合使用 16px。
- `full` 用于圆形图标动作和材料 Badge，不给普通矩形控件统一加胶囊外观。

## Components

以下约定描述组件外观与状态。参数、事件和实际状态入口由[组件库](http://127.0.0.1:5173/ui-catalog/)维护。

| 组件 | 默认外观 | 状态规则 |
|---|---|---|
| Button default | primary-strong 填充、成对前景、32px 高、8px 圆角 | hover 使用 primary-strong/90；普通按钮按下位移 1px；disabled 透明度 50%，不可触发 |
| Button send | primary 填充、圆形图标动作 | 仅用于图标，使用可访问名称；悬停 primary-strong，禁用透明度 50% |
| Button outline | 内容底面、border 边界、正文色 | hover 或展开使用 muted；深色边界和表面按基础变体处理 |
| Button ghost | 透明表面 | hover 或展开使用 muted；目录分组用 section 变体，只在 hover 强调 |
| 输入框 | input 边界、32px 高、8px 圆角 | focus 使用 ring 边界和外环；无效状态有 destructive 边界及可读说明 |
| Select | 与输入框共享尺寸和边界 | 选中项使用 Check；工具栏 ghost 变体隐藏常态边界；禁用不展开 |
| 输入组合 | card 底面、16px 圆角、轻阴影 | 文本、材料和工具栏共享容器；发送可用性由输入状态决定 |
| 菜单 | popover 表面、8px 圆角、浮层阴影 | 项目焦点使用 accent；持久选择使用 Check 或单选语义 |
| Dialog | popover 表面、12px 圆角、16px 内边距；会话配置按上表覆盖 | 提供标题、关闭动作和焦点回归；Escape 行为由基础组件处理 |
| 模型与思考 | 同一胶囊入口，模型名 + 思考强度 | 根菜单选择分类，返回或 Esc 退一级并恢复入口焦点；上下/Home/End只移动焦点，Enter/空格确认后回写并关闭。空目录可打开设置，失败可重试，加载显示状态，未选模型不显示思考等级 |
| 会话配置 | 工具和项目指令两个页签 | 暂存候选值；取消丢弃，后端应用成功后回写；已保存且未更改时禁用应用；重新加载指令可再次应用 |
| 工具列表 | 搜索、来源组、勾选与详情 | 全选/全不选作用于来源全组；过滤时显示作用范围提示，过滤不清除选择；详情在行下方全宽展开 |
| Badge | 紧凑分类标签、20px 高、12px 字号 | 材料有类型图标、名称和独立移除动作；不只用颜色区分类型 |
| 分组与导航 | 文字、图标和统一起点 | ChevronRight/ChevronDown 表达展开；当前项目另有选中语义，展开不等于选中 |

### 模型设置工作区

模型设置沿用原型的目录与详情结构。主应用侧栏保留，设置顶栏60px、分区导航208px；内容内距32px，窄容器16px。设置区宽度不超过760px时收起分区导航，内容铺满；当前分区为模型连接。标题20px/28px、600字重，说明13px/20px。连接编辑替换目录内容，不使用连接编辑弹窗。

连接目录四列为连接、端点与凭据、状态与模型、操作。边框8px圆角、表头36px、连接行64px；模型目录行78px。表格在局部横向滚动，不扩张整页；长名称/端点截断并保留完整悬停文本。内容仍统一思源黑体，技术标识不用外部等宽字体。失效状态同时显示文字与原因，不只依靠红色。

服务表单最大768px；名称与端点双列，小视口单列。凭据方式用RadioGroup；密钥输入默认遮蔽，右侧提供显示/隐藏与复制；已保存值按需读取，不触发表单脏状态。请求头多行输入始终展开；Field的错误与控件关联。测试、模型增改与候选选择不会自动保存；66px最小高度的固定底栏承载取消和保存，忙状态禁用重复提交；发现与检查提供“取消请求”并保留草稿，保存期间离开说明等待原因；删除请求取消后重新读取目录，不承诺回滚已提交数据。取消或导航时未保存草稿必须确认。

添加方式弹窗560px、模型编辑弹窗680px、授权弹窗480px。模型弹窗正文可滚动，标题与动作区固定，全部字段逐项验证。模型ID与连接ID共同决定身份，显示名相同不合并；失效的原选择保留并提示修复连接或重新选择。授权显示设备码、服务确认信息、授权范围及等待/失败/过期；取消中止在途响应。模拟依赖通过ModelService注入，演示失败控制只放在组件库。

源码：`src/features/models/`；组件库：`model-settings-page`、`connection-editor`、`connection-fields`、`model-directory`、`model-editor`、`subscription-authorization`等相邻定义。

## Do's and Don'ts

- 使用同一套语义 token，前景与背景成对引用；不按页面另造相同语义的色值。
- 保留 hover、focus、selected、expanded、disabled 各自的语义，不混用一种背景代替所有状态。
- 图标有文字时作为辅助；只有图标的按钮必须有可访问名称。
- 所有文字使用本地思源黑体；不要在局部引入其他字体或仅依赖系统已安装字体。
- 不用 Emoji、字符箭头、图标字体或手绘路径替代 Lucide 图标。
- 修改共享样式时同步检查正式页面与组件展示；不能把尚未认可的页面排布写成全局设计规则。

## Customization

主题入口为 `src/index.css` 的 `:root` 与 `.dark`。Tailwind 的 `@theme inline` 将这些 CSS 变量映射到 `bg-*`、`text-*`、`border-*` 等语义工具类；`ThemeProvider` 负责浅色、深色与跟随系统。深色替换如下，文字级差、尺寸和图标规则不变；`color-scheme` 同步为 light / dark，使原生滚动条与主题一致：

| Token | 浅色 | 深色 |
|---|---|---|
| background | `#f8f9fb` | `#12151d` |
| foreground | `#17202f` | `#edf0f5` |
| card | `#ffffff` | `#1a1e28` |
| card-foreground | `#17202f` | `#edf0f5` |
| popover | `#ffffff` | `#1a1e28` |
| popover-foreground | `#17202f` | `#edf0f5` |
| primary | `#4176e6` | `#6c9aef` |
| primary-strong | `#3568d4` | `#6c9aef` |
| primary-foreground | `#ffffff` | `#0b1220` |
| secondary | `#e9edf4` | `#232935` |
| secondary-foreground | `#2a3343` | `#edf0f5` |
| muted | `#e9edf4` | `#232935` |
| muted-foreground | `#5b6574` | `#9aa4b3` |
| accent | `#e9eef7` | `#232935` |
| accent-foreground | `#2a3343` | `#edf0f5` |
| destructive | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` |
| border | `#e3e8f0` | `rgb(255 255 255 / 9%)` |
| input | `#e3e8f0` | `rgb(255 255 255 / 15%)` |
| ring | `#4176e6` | `#6c9aef` |
| sidebar | `#f9fafb` | `#171b26` |
| sidebar-foreground | `#17202f` | `#edf0f5` |
| sidebar-primary | `#4176e6` | `#6c9aef` |
| sidebar-primary-foreground | `#ffffff` | `#0b1220` |
| sidebar-accent | `#e6eefc` | `#232c3d` |
| sidebar-accent-foreground | `#2c56b8` | `#a8c3f7` |
| sidebar-border | `#e3e8f0` | `rgb(255 255 255 / 9%)` |
| sidebar-ring | `#4176e6` | `#6c9aef` |

调整全局外观时先修改主题变量，再同步本文件中的值。组件专属规则在基础组件的变体中调整，避免页面重复覆盖。展示 iframe 使用相同样式入口和独立主题状态，不改变正式页面的主题偏好。

## Icons

唯一图标库为 [Lucide](https://github.com/lucide-icons/lucide)，React 页面从 `lucide-react` 按名称导入。使用官方 24 × 24 viewBox、2 单位线宽、圆头与圆角连接，默认无填充，颜色继承当前文字色。

常规操作图标 16px；紧凑按钮与树导航 12–14px；侧栏搜索为 14px，导航为 16px，收起后的图标列为 18px；侧栏品牌仅显示小写 moon，不配图标；侧栏开关使用无箭头的 PanelLeft。同一操作上下文采用同一尺寸，不单独调整图形路径或线宽。图标与标签间距 4–8px。折叠箭头可旋转表达状态；装饰图标设 `aria-hidden`，操作名称写在按钮或链接上。

首页、组件库和基础组件的操作图标都使用这一来源。应用品牌独立设计：`public/moon.svg` 为蓝色圆角方形上的白色实心月牙，蓝色使用 primary `#4176e6`。1024px 画布四周48px透明留白，底板928px、圆角240px；月牙右上开口，不加文字、星点或细描边，保证16px识别。浅深主题共用同一品牌资产，侧栏仍只显示 moon 文字。网页与桌面共用此SVG，桌面PNG/ICO/ICNS由Tauri官方CLI生成；品牌不使用Lucide字形。

结构参考：[Ant Design design.md](https://ant.design/design.md)。


### 首页展开界面的具体规则

- 搜索会话：宽度640px、圆角16px，最大高度680px；标题18px，说明13px，输入40px；结果计数11px，名称14px、路径12px、时间11px。结果无前置消息图标，右侧 ChevronRight；查询匹配用 primary 的20%透明度背景。输入保留焦点，方向键定位、Enter选择，每次打开清空查询。
- 账户菜单：224px宽、12px圆角；设置行含 Settings，主题含 Sun / Moon / Monitor，选中使用尾部 Check。移除无操作的账户区说明。
- 目录菜单：220px宽、24px圆角、40px行；名称单行、路径放在title，底部“添加工作区…”；添加直接打开 Windows 原生目录选择器；等待时禁用重复操作，取消不改变当前目录，失效目录保留并标明不可用。
- 材料候选：锚定整个输入卡，向上间隔4px、同宽、16px圆角，列表最大320px并受可用高度限制；分组标题12px，候选40px，左图标16px、名称14px、右描述12px。引用资源进入搜索子面板，保持同一锚点；模板只填入草稿，文件仅保存前端元数据。
- 会话配置：标题区顶部18px，标签36px且下划线贴底；有未应用修改的标签显示5px主色圆点。工具行内距8px、复选框16px、名称13px/20px、说明12px/18px；详情在行下方，用左边界与来源/工具名元数据建立层次。配置取消不回写，应用才更新草稿。


### 对话空间

沿用 agenttool 原型 020 会话视图与 022 工作台。共享侧栏保持首页尺寸。标题栏56px，标题14px/20px，状态12px；消息滚动口铺满会话主区并贴主区最右侧，内部消息正文最大748px且居中；输入外框812px、左右16px，卡片可见宽度780px。窄屏正文左右保留16px、输入12px；输入区最多占会话正文区域55%，短正文容器（低于360px）允许输入区扩展并内部滚动，保留消息阅读入口。

- 用户消息使用右侧气泡，圆角22px、内距10px 16px；正文保留原文与换行，附件在气泡前。Agent正文不使用气泡、头像或装饰边框，正文14px/24px。两条消息间距16px；附件与气泡间8px，用户操作栏距内容6px，Agent操作栏距正文16px。
- 思考与工具摘要行28px；思考标题13px、图标14px；执行过程汇总行33px带底边线。输入与输出详情展开到行下，失败/中断既有文字也有图标。长结果可展开，不让整段输出撑大首屏。
- Markdown 标题、列表、表格与代码块共享正文色系；代码可复制，链接新窗口打开且限制安全协议；不渲染原始HTML。附件预览使用Dialog，关闭后恢复触发点焦点。
- 消息列表使用官方MessageScroller。首次打开定位最新内容；用户向上阅读时暂停跟随；回到底部恢复。会话阅读位置由应用层保存，切换到首页后仍可恢复。右侧轮次轨28px，保持在正文阅读列侧边，与主区最右侧滚动条分离；滚动条8px、透明边2px且无箭头；刻度12×2px，当前20×2px，悬停/聚焦预览跟随刻度位置。会话容器窄于900px时隐藏轮次轨，仍可滚动与返回最新。
- 输入卡圆角16px，正文15px/24px，发送按钮34px圆形。空白禁发；正式基础对话生成中始终显示停止，可提前编辑下一条草稿，结束后才可发送；停止中锁定操作。材料、模型和配置复用首页正式组件。
- 以下队列与分步问答仅在组件库展示，正式基础对话尚未接入。队列位于输入上方、最大高度180px，提供编辑、移除、立即发送和逐条/全部投递模式；停止后仍提供“发送此消息”，不会丢弃未处理队列。问答替换普通输入，支持单选、多选、自由输入、翻页、跳过、收起与恢复；切换会话保留草稿；取消回到普通输入。
- 上下文用量置于输入底部，通过Popover展示分解与累计值；压缩操作必须回写状态，运行中禁用。用量与压缩结果由宿主提供，不从显示组件推断。

#### 对话内容与展开状态

- Markdown 正文14px/24px；段落与列表间距16px；一级/二级/三级标题21/19/18px，行高30/28/26px，标题前32px、后16px。表格只用横向细分隔，单元格10px × 16px、首列左内距0；宽表与代码分别横向滚动，不撑宽消息列。
- 只读任务项采用 Lucide 完成/未完成标记，保留原有段落与嵌套列表文档流，不显示可编辑复选控件；状态有文本语义，不能只靠颜色。
- 消息动作命中区28px、图标15px；默认可见；不存在模型等有效消息信息时不显示信息入口。复制反馈使用同一位置，失败与中断保留已有文本及恢复动作。
- 文件附件宽240px、最小64px高、16px圆角、独立28px文件图标；长名截断但保留完整名称入口。单图最长边240px、不放大，多材料图片缩略64px；加载与错误有对应反馈。预览保持图像比例，长文本在弹窗内部滚动。
- 回复可以由有序文字、工具调用与附件块组成，按发生次序显示，不将所有工具强行挪到正文前。工具摘要标出失败，展开后分开显示参数与结果；长参数和结果局部滚动，错误信息保留具体原因。
- 输入与问题卡按会话标识隔离临时状态；草稿与回答由会话数据保存。取消配置不改写草稿，切换会话不会把未应用配置或旧问题选择带到其他会话。

### 侧栏会话状态

状态占标题左侧已有缩进中的10px位置。运行/正在停止使用Lucide旋转环（primary），待回答为琥珀色状态点（status-warning #f59e0b），未读完成为绿色点（status-success #22c55e），未读失败使用destructive。颜色沿用原型StateDot语义，状态有可访问文本和悬停说明；空闲已读时状态位留空，标题与时间不移动。正文成功显示且运行标识/终态匹配后才清除未读结果，正在运行和待回答不会因打开而消失。减少动态效果时停止旋转。状态由后端运行状态与独立 unread 字段派生，不用条目的选中样式冒充执行状态。

### 模型选择弹层

`ModelPicker` 打开时按最大360px列表需要选择可用侧，限制高度在该侧可用空间内；切换子页保持展开方向，只纵向滚动。连接标题与模型身份分开，不把提供方拼到长标题尾部。模型行由 `PickerOption` 复用 Button，正文可换行、最小40px高，焦点与选中分开：焦点使用控件焦点态，Check仅表示实际选择。`ThinkingPicker`使用相同确认语义；既有非菜单单选控件不受影响。模型设置留在根菜单底部，与选择区由Separator分开。

展示入口为组件库的 model-picker、thinking-picker、picker-option；正式使用方为首页工具栏和会话输入器。加载、错误、重试和设置导航由页面传入，展示环境不能调用真实模型服务。

### 模型凭据表单

API密钥始终使用固定位置输入框，默认密码遮蔽。右端按顺序放Lucide Eye/EyeOff与Copy/Check图标按钮，图标16px，复用InputGroup；按钮有可访问名称与原生标题。已保存密钥只在显式显示或复制时读取，读取有忙反馈、失败在字段下说明，复制成功显示“已复制密钥”。隐藏与离开清理读取值，不把查看当编辑。自定义请求头紧接凭据区域，标题、4行JSON输入和说明始终展示；使用既有Field间距与表单宽度，窄屏不另起按钮行。

### 会话配置的真实状态

保留600×500双页签弹窗和底部操作栏。读取中用Skeleton保持内容高度，失败在正文用Alert说明并提供重新读取；应用期间禁用候选编辑与关闭，按钮显示“应用中…”，底栏左侧以12px辅助文字说明“正在保存，请稍候…”。保存组件同步取得共享导航租约，应用路由、搜索、鼠标导航和Ctrl+K/Ctrl+B都等待同一结果，不能通过打开第二个浮层卸载保存画面。成功关闭后原入口显示“配置已应用”，下次打开恢复“会话配置”；失败保持弹窗、候选和具体错误，结果返回后才解除导航边界。工具缺少依赖时禁用选中并写明原因，已保存但失效的工具明确提示，不静默丢弃。

项目指令按来源列出实际路径，长路径换行；正文通过折叠预览保持列表密度。明确区分已保存快照与本次磁盘候选，文件变化时提示差异并启用应用；没有指令是空状态，读取失败是错误状态，两者不混淆。取消不写入，异步结果以会话ID和目录归属校验，切换会话不能带入旧候选。


### 真实对话反馈

正式页面使用 `LiveConversationView`，服务快照与输入草稿分开。请求失败在输入区上方说明原因，旧消息与未发送文字保留；读取恢复只清读取错误，不清除发送失败。只有已接受输入且存在真实用户消息的失败或停止请求才提供“继续上次回复”，通过Pi新增可见继续指令，不声称重新生成。写入前失败或中断显示重新发送指引，首页与会话都按会话ID保留原草稿，从侧栏打开失败会话仍可恢复文字；发送被接受后才清空同一文本，不覆盖期间编辑的新文字。已有历史也不能替代本次输入是否被接受的判断。生成期间禁改会话配置。附件与Skill尚未接入时禁用材料入口；只在Pi返回实际上下文用量时展示，不显示模拟压缩按钮。

### 运行阶段与执行结果

### 运行中发送与待处理消息

运行中 Enter 将输入加入当前会话的待处理列表；停止按钮继续独立显示。列表位于输入卡上方，沿用原型的紧凑摘要，可展开完整内容、编辑、删除，或发送为当前工作的补充。已开始交付的内容显示状态并禁止重复修改。逐条/全部交付控制位于输入区的上下文信息旁，不占据发送主动作；全部模式仍保持每条消息和附件独立。停止、失败及重新打开后的队列明确显示暂停，用户主动继续后才发送。运行中模型与思考强度保持当前值。

请求结果未知时显示“核对发送”，核对原输入及请求身份；输入区保留期间编辑的新草稿。保存失败提供重试，不用成功反馈覆盖未确认状态。

`LiveConversationView` 在输入卡上方复用 `ExecutionFeedback`，用正式 Pi 事件区分正在回复、正在执行工具、等待重试和正在压缩上下文。当前工具名称与阶段同一行，重试显示已记录次数、上限和等待倒计时；未提供次数或等待时间时不推断。倒计时结束仅显示即将重试，实际阶段仍由后端事件改变。状态主行13px/20px、辅助行12px/18px，Lucide图标由Marker统一16px；primary仅强调当前运行，减少动态效果时停止旋转。停止反馈优先，操作仍由输入卡原停止按钮承载。

压缩可能发生在回复结束后，不承诺完成后必定自动续回复。压缩失败以静态Alert保留提示，使用已有status-warning的5%背景和30%边框混色，说明已保留历史；不将非阻断的整理失败等同整次回复失败。结束状态称“回复结束”，工具成功和模型结束都不替代任务结果验收。

`ToolCall` 保留原型的摘要、输入与结果折叠。结果下方并列显示正式结构化退出码与耗时；0是真实成功码，非0显示失败，命令缺少码时显示“已返回/退出码未提供”，不从输出文字猜测。耗时小于1秒显示毫秒，其余显示秒。长输入最多240px、长结果最多280px局部滚动，20行结果预览后可以展开已保存内容，避免整个会话被日志撑开。

### 上下文统计来源

`ContextUsage` 沿用304px、12px圆角的顶侧Popover及轻量百分比入口。正式统计来自 Pi getContextUsage，明确标记估算，说明由模型返回用量和后续消息估算；不称精确请求大小或计费用量，不展示不存在的分项、累计。详情记录来源、模型容量、统计状态与原观察时点；历史恢复保留原时间并注明并非实时请求。压缩后等待下一次模型报告时显示“上下文待更新”，没有数据时显示未知及原因，不补0；只有明确的零占用记录可以显示0%，已知非零且不足百分之一时显示“<1%”，占用条保留实际比例。

### 手动压缩

上下文面板的“压缩当前上下文”与输入 `/compact [保留重点]` 打开同一 `CompactDialog`。面板复用 Dialog/Field，最大宽度576px、内容间距16px；先显示会话、模型、当前路径范围，再显示4行可选重点输入，底部仅开始或取消本次操作。运行、待答、未处理队列或操作待确认时，就近说明不可用原因。开始后重点只读，提供“返回会话”“检查压缩状态”“取消压缩”；返回不取消后台任务，关闭后草稿可继续编辑。取消结果依据Pi实际提交边界，摘要已保存时显示完成。

`CompactionRecord` 在Pi条目的真实位置复用Marker与Collapsible，展开只读摘要、时间、压缩前估算及保留起点。摘要最多288px局部滚动，查看定位由既有MessageScroller负责；没有可定位消息时说明原因。没有准确新用量时只显示“压缩后占用待更新”。失败、取消保留该次命令和重点，成功只清除同一条尚未修改的命令。

实现分别位于 `src/features/conversation/execution-feedback.tsx`、`messages/tool-call.tsx` 与 `composer/context-usage.tsx`；相邻展示定义直接导入正式组件，覆盖回复、工具、两种重试、压缩、压缩失败、停止、命令0/非0/未知、历史恢复与未知占用，主题及视口由组件库真实预览控制。


### 会话派生

已保存Agent回复的尾部动作组显示Lucide GitBranch“在新会话中分支”，复用icon-sm尺寸，与复制和消息信息一致。来源执行、待答、压缩、待处理消息或边界未完成时入口保留，以Tooltip说明原因；用户消息没有同名入口。点击直接创建并打开普通新会话，不增加命名或确认弹窗，进行中防重复，错误与未知查询紧邻当前输入区显示。切换来源会话后，迟到结果不改变当前导航。

新会话标题区显示“派生自 · 来源标题”及“打开来源会话”，使用既有辅助文字与ghost按钮，不增加family看板；侧栏保留源和新会话。新输入为空，不复制来源未发送材料或队列。

### 开发目录页面

目录沿用 Moon 的主题 token、思源黑体与 Lucide 图标。组件库桌面保留可调宽度的组件树、预览和文档三栏，各栏独立滚动；959px 以下使用组件树/预览/文档 Tabs，切换文档保留运行中的预览。顶栏分开查看方式、当前组件、状态与视口控制，复制/主题/重置/独立打开有名称与即时反馈。概览按状态列出条件及预期，一次展开一个实际示例；右侧显示当前状态说明、输入/事件、组成/使用方和按需源码。画布尺寸在 Enter 或失焦提交，非法值保留原尺寸并在输入旁说明，Escape 恢复。链接包含主题和实际尺寸，目录主题不改正式应用的外观。

接口目录使用56px页头、264px导航栏，默认文档与调试入口并列；打开调试后宽屏并列契约和调用面板，1180px以下改为纵向阅读，760px以下通过导航Dialog定位。页面先说明用途、数据变化、调用条件与错误，再展示可搜索的请求/返回字段；无参数接口直接注明空对象及额外字段约束，联合类型与可空值分行说明。调用区独立标明目标和实际影响，JSON错误紧邻输入，执行/取消和响应状态明确区分。收起调试取消等待并保留草稿与结果，焦点返回打开按钮；延迟载入的调试/架构内容聚焦明确标题，移动导航和菜单沿用 Radix 的焦点管理。空搜索提供恢复动作，成功、失败、等待、取消与未执行有各自反馈；复制失败不能显示成功。窄屏Dialog支持搜索、方向键选择、Enter打开及Escape关闭。请求编辑期间保持文档引用稳定，结果区采用局部滚动，避免大响应撑开全文。
