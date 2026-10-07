import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { HomeStoryExample } from "../../../ui-catalog/fixtures/home-stories"

export default {
  id: "selected-materials",
  name: "输入带附件的消息",
  source: "src/features/home/home-composer.tsx",
  group: "输入带附件的消息",
  layer: "复合组件",
  order: 107,
  pages: ["首页"],
  stage: "content",
  description:
    "用户添加图片或普通文件附件，等待准备、预览或移除，再和正文一起发送。",
  boundary:
    "示例直接复用完整 HomeComposer，服务、草稿和浏览器存储只存在预览内存。演示到首页 onSubmit 回调结束，不模拟路由成功或 Agent 回复，不修改对话页面。 加号的原生选文件由内存服务替代；粘贴/拖入仍经过正式网页上传入口，不读取用户磁盘。",
  story: {
    goal: "把图片或文件路径作为材料加入请求，确认内容并处理失败或模型不兼容。",
    preconditions: [
      "加号菜单提供添加附件；图片演示源不访问真实用户数据。",
      "默认文本模型不接受图片，需要选择Vision；正常链路从无附件开始。",
    ],
    result:
      "图片准备就绪且模型支持后提交；预览、移除和取消各自明确，失败材料不混入有效提交。",
  },
  standards: [
    {
      id: "A1",
      name: "混合附件轨道",
      rule: "图片64×64真实缩略图，普通文件64px高名称/大小卡，共用12px圆角和边框；右上24px移除动作位置与底色一致，文件内容留出动作空间，预览与移除分离。@引用与Skill不重复成附件卡。",
      reason:
        "图片需查看内容，文字引用已有正文位置，不同表达形式各有任务理由。",
      check: "真实添加图片→预览→关闭→移除；检查动作不互相触发。",
    },
    {
      id: "A2",
      name: "准备与恢复",
      rule: "准备、失败和恢复只属于对应材料；取消不添加；格式/大小拒绝保真实原因，临时图片仅在源仍可用时重试，同路径文件重新选择成功原位替换失败项。",
      reason: "用户必须知道哪一个附件阻塞了发送，不应再增加重复总说明。",
      check: "准备中、失败、取消、预览错误检查局部原因、恢复与正文保留。",
    },
    {
      id: "A4",
      name: "查看图片与文件",
      rule: "图片在独立暗遮罩内保持自然比例并适配视口，不放入正文面板；文件保完整标题、路径和只读原文，标题与正文各自受视口限制，长文局部滚动。",
      reason:
        "看图需要画面空间，读文件需要明确来源和连续阅读；两者共用关闭与焦点恢复。",
      check:
        "空稿选择小图、宽图、长图和短长文件；390px、短视口及浅深主题下预览，确认关闭、恢复和原稿保留。",
    },
    {
      id: "A3",
      name: "能力与布局",
      rule: "图片不兼容只阻止发送，仍保留真实缩略图/预览/移除；多材料局部轨道滚动、键盘可达，不撑出工具栏。原生choose支持普通文件路径，网页拖入普通文件缺路径协议须明确说明，不能伪装为上传成功。",
      reason: "模型能力是真实提交条件；多材料不能破坏输入的主要操作。",
      check: "文本模型阻止发送、Vision恢复；窄窗多图、Home/End与移除最后一张。",
    },
  ],
  inputs: [
    "MaterialService.choose返回图片及普通文件路径记录；网页upload仅支持图片。客户端presentation区分附件与正文引用，不进入DTO",
    "Material.status决定是否ready；thumbnail是预览缓存，不作为提交身份",
    "data.modelInputs决定图片是否能提交；示例模型有明确text/image差异",
  ],
  events: [
    "加号添加附件→choose；网页粘贴/拖入→upload",
    "prepare/preview/restore按材料id查询；取消返回[]不改变草稿",
    "移除同步materials；onSubmit只带可用ready材料",
  ],
  composition: [
    "HomeComposer / MaterialPicker / SelectedMaterials / Attachment / MaterialPreviewDialog",
  ],
  consumers: ["首页输入区"],
  states: [
    {
      id: "add-preview-send",
      name: "添加、预览与发送",
      section: "normal",
      condition: "空正文无附件；先选择支持图片的Vision。",
      steps: [
        "选择Vision模型，点击加号→添加附件。",
        "等待图片和说明.md就绪，分别预览并关闭；图片有真实缩略图，普通文件卡不自动插入@正文。",
        "输入“描述这张图片”。",
        "发送并展开演示数据，检查正文及两种完整材料。",
      ],
      expected:
        "准备和预览经过真实组件边界；两种附件各一次加入，正文与材料形成提交。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "preview-layout",
      name: "图片比例与文件阅读",
      section: "normal",
      condition:
        "完整Home空稿；选择返回真实小图、宽图、长图和短长文件，均在隔离内存。",
      steps: [
        "点击加号→添加附件；沿混合轨道依次预览小图标.png、首页设计.png和交付清单.png。",
        "点击图片本身不关闭，点击空白、关闭按钮或Escape退出；焦点回到对应卡，再继续编辑。",
        "预览说明.md和长路径阅读记录，选择完整来源文字并滚动阅读至文档结束。",
        "在390px、短视口和浅深主题下重复；分别移除图片与文件，确认同右上动作且未误开预览。",
      ],
      expected:
        "图片无760px白色面板，不强迫小图放大、长宽图不溢出；阅读标题/路径和关闭始终可达，正文独立滚动，原稿及其他材料保留。",
      render: () => <HomeStoryExample scenario="preview-layout" />,
    },
    {
      id: "preview-loading",
      name: "看图读取等待与关闭",
      section: "states",
      condition: "空稿添加图片；缩略图完成后由演示区明确让下一次该图弹窗等待。",
      steps: [
        "添加附件，展开演示数据，点击让下一次图片弹窗等待读取。",
        "打开图片，检查暗遮罩中的可读等待反馈；按Alt+Shift+R完成读取并查看图片。",
        "重置场景再次等待，Escape关闭后重新打开，确认旧请求不覆盖本次内容。",
      ],
      expected:
        "等待有明确反馈；完成后按视口看图，关闭取消旧请求且保原稿与焦点。",
      render: () => <HomeStoryExample scenario="preview-pending" />,
    },
    {
      id: "preview-decode",
      name: "图片无法解码",
      section: "exception",
      condition: "空稿添加就绪图片，缩略图完成后仅下一次弹窗返回无效图片数据。",
      steps: [
        "添加附件，展开演示数据，点击让下一次图片弹窗无法解码。",
        "打开图片，检查无法显示图片及重新选择说明；点击反馈不关闭。",
        "关闭后再次打开，查看有效图片，继续编辑或移除该图。",
      ],
      expected:
        "真实img解码失败与读取错误分别表达；错误可读且不会改变材料就绪身份、原稿或其他附件。",
      render: () => <HomeStoryExample scenario="preview-decode" />,
    },
    {
      id: "remove",
      name: "移除图片保留正文",
      section: "normal",
      condition: "从空稿真实添加。",
      steps: [
        "添加演示图片并输入正文。",
        "点击独立移除按钮，确认未触发预览。",
        "只发送文字。",
      ],
      expected: "移除只删目标材料，不删除正文、不留下提交身份。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "file-reselect",
      name: "重新选择修复失败文件",
      section: "normal",
      condition:
        "空稿；首次选择返回一项失败文件及另一项就绪文件，重新选择该文件成功。",
      steps: [
        "输入正文，点击加号→添加附件。",
        "确认README.md失败、说明.md就绪，再次添加附件。",
        "预览恢复后的README.md并发送。",
      ],
      expected:
        "README.md原位成为唯一就绪项，旧错误消失；说明.md、正文及顺序保留。服务为内存替身，不代表原生选择器已验。",
      render: () => <HomeStoryExample scenario="file-reselect" />,
    },
    {
      id: "inline-reselect",
      name: "正文引用重新选择仍留正文",
      section: "normal",
      condition: "空稿；选择README.md引用检查失败，随后加号重新选同路径成功。",
      steps: [
        "输入@并选择README.md，继续写正文或普通/skill:review文字。",
        "点击加号→添加附件重新选择同路径文件。",
        "确认该文件仍是正文引用，没有重复附件卡；预览并发送。",
      ],
      expected:
        "失败身份换成就绪身份，保原reference表达、文字及其他材料；不删除引用、不新增隐藏副本。",
      render: () => <HomeStoryExample scenario="file-reselect" />,
    },
    {
      id: "image-only",
      name: "仅发送图片",
      section: "normal",
      condition: "空正文无附件；使用支持图片的模型。",
      steps: [
        "选择Vision后添加附件，或实际粘贴PNG。",
        "移除普通文件，保留图片且不输入正文。",
        "预览图片，关闭后发送并检查回调。",
      ],
      expected: "仅图片也可发送；只提交当前保留的就绪图片。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "cancel",
      name: "取消附件选择",
      section: "exception",
      condition: "选择服务返回[]。",
      steps: [
        "输入原正文，再点击添加附件。",
        "等待取消返回。",
        "核对正文与附件数量。",
      ],
      expected: "取消没有错误，不新增材料也不改正文。",
      render: () => <HomeStoryExample scenario="attachment-cancel" />,
    },
    {
      id: "prepare-failure",
      name: "附件准备失败恢复",
      section: "exception",
      condition: "首次准备失败，第二次可成功。",
      steps: [
        "点击加号添加附件。",
        "查看所属操作失败，再按恢复或重新选择。",
        "切Vision并预览。",
      ],
      expected: "失败可定位、可恢复且无假ready；原正文保留。",
      render: () => <HomeStoryExample scenario="prepare-error" />,
    },
    {
      id: "local-validation",
      name: "格式与大小拒绝保原因",
      section: "exception",
      condition:
        "空稿；实际粘贴SVG或超过8MiB的图片，或在网页拖入无实际路径的普通文件，走正式入口校验。",
      steps: [
        "输入正文并选择Vision，实际粘贴SVG或超限图片；普通文件可另走网页拖入反例。",
        "检查具体格式/大小原因，没有重试准备入口；等待后原因不变。",
        "切换工作目录再返回，移除失败项后继续正文发送。",
      ],
      expected:
        "不被替换为材料标识无效，不伪装上传成功；拒绝项不可重试，正文和其他材料保留。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "upload-failure",
      name: "真实图片粘贴失败重试",
      section: "exception",
      condition: "空稿；首次上传服务失败，保留实际File供重试。",
      steps: [
        "选择Vision并输入正文，实际粘贴PNG。",
        "确认失败原因保留，点击该图重试准备。",
        "预览恢复图片并发送；核对只保留一项图片及原正文。",
      ],
      expected: "上传失败不被restore覆盖；重试真实上传入口，只替换失败项。",
      render: () => <HomeStoryExample scenario="prepare-error" />,
    },
    {
      id: "upload-restore",
      name: "失败图片重开与源丢失",
      section: "exception",
      condition:
        "从空稿实际粘贴PNG；首次上传失败，驱动只模拟输入重开和前端内存源丢失。",
      steps: [
        "选择Vision、输入正文并粘贴PNG，等待失败。",
        "切notes输入另一稿，再回moon；展开演示区重开输入，确认原稿/原因仍在且可重试。",
        "点击模拟重启，确认原原因仍在并明确重新选择，不再提供无源重试。",
        "移除失败项，重新粘贴PNG并发送。重置场景可另验保源重开后重试成功。",
      ],
      expected:
        "同服务重开可使用限时File；更换服务后保草稿、明确源丢失，绝不发未知身份restore或假ready；不承诺真实宿主重启已验。",
      render: () => <HomeStoryExample scenario="upload-restore" />,
    },
    {
      id: "preview-failure",
      name: "预览读取失败恢复",
      section: "exception",
      condition:
        "实际添加图片，缩略图结束后在演示区明确让下一次该图片弹窗读取失败。",
      steps: [
        "默认文本模型下添加附件，等图片缩略图读取结束。",
        "展开演示数据，点击让下一次图片弹窗读取失败，再打开该图预览。",
        "查看失败并重新读取，关闭后继续输入、切Vision并发送。",
      ],
      expected: "预览失败不删除材料；原位恢复和关闭焦点有效。",
      render: () => <HomeStoryExample scenario="preview-error" />,
    },
    {
      id: "thumbnail-failure",
      name: "缩略图失败仍可预览",
      section: "exception",
      condition: "空稿添加图片，缩略图请求单独失败；弹窗可正常读取。",
      steps: [
        "添加附件，等待缩略图显示加载失败。",
        "点击图片卡预览完整图片，关闭后继续输入。",
        "切Vision发送，或移除图片后发送文字。",
      ],
      expected: "缩略图错误不改变就绪材料，不自动循环；弹窗读取及移除仍可用。",
      render: () => <HomeStoryExample scenario="thumbnail-error" />,
    },
    {
      id: "preparing",
      name: "附件准备等待",
      section: "states",
      condition: "choose或upload等待演示解除。",
      steps: [
        "点击添加附件，检查重复选择与发送条件。",
        "按Alt+Shift+R完成等待，核对只添加一次。",
        "重置后实际粘贴PNG、准备中移除，再解除等待，确认迟到结果不重新添加。",
      ],
      expected: "等待不允许重复添加、不能发送未就绪材料；完成后附件可预览。",
      render: () => <HomeStoryExample scenario="prepare-pending" />,
    },
    {
      id: "many-images",
      name: "多图轨道",
      section: "states",
      condition: "预置8张仅验证布局，不能当正常添加流程证据。",
      steps: [
        "在390px和800px检查轨道局部滚动。",
        "使用左右/Home/End定位图片。",
        "预览和移除最后一张，继续编辑。",
      ],
      expected: "全部材料可到达，删除不覆盖正文，工具栏始终可操作。",
      render: () => <HomeStoryExample scenario="attachment-many" />,
    },
    {
      id: "incompatible",
      name: "模型不支持图片",
      section: "states",
      condition: "预置一张ready图片，仅核对能力边界。",
      steps: [
        "检查文本模型下发送不可用原因。",
        "更换Vision模型，检查发送恢复。",
        "移除图片并切回文本模型。",
      ],
      expected: "限制由modelInputs决定；只允许换模型或移除，不弱化提交校验。",
      render: () => <HomeStoryExample scenario="image-incompatible" />,
    },
  ],
  viewport: {
    width: 800,
    height: 680,
  },
} satisfies CatalogEntry
