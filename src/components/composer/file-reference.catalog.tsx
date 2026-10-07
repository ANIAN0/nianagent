import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { HomeStoryExample } from "../../../ui-catalog/fixtures/home-stories"

export default {
  id: "file-reference",
  name: "输入引用文件的消息",
  source: "src/features/home/home-composer.tsx",
  group: "输入引用文件的消息",
  layer: "复合组件",
  order: 106,
  pages: ["首页"],
  stage: "content",
  description: "用户通过 @ 选择文件或目录，在正文中继续编辑并提交引用。",
  boundary:
    "示例直接复用完整 HomeComposer，服务、草稿和浏览器存储只存在预览内存。演示到首页 onSubmit 回调结束，不模拟路由成功或 Agent 回复。文件检查与预览不会证明 Agent 已读正文；候选排序复用正式后端纯排序函数，真实宿主扫描、模型读取及重启恢复仍需对应环境验证。",
  story: {
    goal: "在请求的具体位置引用一个文件或目录，并可靠地保留引用身份。",
    preconditions: [
      "演示目录含README.md、嵌套源码和docs目录。",
      "正常例从空稿输入@，引用尚未检查。",
    ],
    result:
      "正文原子引用与权威材料id同步；继续编辑、删除和撤销后仍能正确提交，无重复附件卡。",
  },
  standards: [
    {
      id: "F1",
      name: "原子引用形式",
      rule: "@候选与＋工作区文件选择后立即插入正文原子引用；正在检查、不可用和就绪状态都只显示一次。显示可识别相对路径；不可用引用提供具体原因，仅可重试项提供重新检查，不可重试项指引重新选择或移除，就绪点击预览。",
      reason: "引用属于正文表达，不是图片附件；重复相对/绝对路径不能帮助输入。",
      check:
        "分别通过@与＋真实选择；检查期间继续编辑，不可用时重新检查或移除；就绪预览并核对正式回调。",
    },
    {
      id: "F2",
      name: "身份交接",
      rule: "选择期间的临时标识在检查完成后同步为权威id；真实节点优先，普通正文仅以完整token与已选身份同步。删最后一处引用移除材料，backup等子串不保留身份；重复引用删一处仍保留，撤销沿原身份恢复。紧邻标点不追加引用，显式移除保留标点正文。",
      reason: "只看就绪外观无法发现继续编辑后的主流程失败。",
      check:
        "从空稿选择→编辑→删除/撤销→发送；对照backup反例、重复引用与紧邻标点的回调材料。",
    },
    {
      id: "F3",
      name: "候选与诊断",
      rule: "候选左名称右必要相对来源，单行36px；名称完全匹配、前缀、包含优先于路径包含，同级目录/名称/路径稳定排列，排序后取60项。空查询与末尾/浏览目录优先。文件诊断只属于文件候选；目录行引用、箭头下钻；未完成候选Enter不误提交。",
      reason: "选择和浏览目录是不同动作；扫描诊断不能混入Skill菜单。",
      check:
        "选择文件与目录分别操作；搜索README.md比较重名、前缀及路径包含；等待/无匹配时Enter不发送；长路径不挤走动作。",
    },
  ],
  inputs: [
    "MaterialCatalog.files 包含file/directory；source固定目录归属",
    "ReferenceNode id和原始路径绑定；prepare返回稳定权威id",
    "MaterialService.restore必须拒绝未知id，不能用路径替代权威身份",
  ],
  events: [
    "@候选选择插入原子引用并检查来源（material.prepare）",
    "编辑器onChange报告引用集合；删除/undo与materials同步",
    "预览调用preview(cwd,id)；发送只能包含ready引用",
  ],
  composition: [
    "HomeComposer / PromptInput / ReferenceNode / ResourcePicker / useComposerMaterials",
  ],
  consumers: ["首页输入区"],
  states: [
    {
      id: "select-edit-submit",
      name: "选择文件后继续编辑与发送",
      section: "normal",
      condition: "空稿；README.md来自演示目录。",
      steps: [
        "输入@并选择README.md。",
        "等待prepare完成，继续输入“请解释这个文件”。",
        "打开事件记录比较prepared与restore标识。",
        "发送，核对payload及阻塞反馈。",
      ],
      expected: "正文引用只出现一次，继续编辑不使材料失效；提交包含权威id。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "delete-undo",
      name: "删除与撤销引用",
      section: "normal",
      condition: "从空稿实际选择文件。",
      steps: [
        "选择README.md并输入后文。",
        "删除原子引用，检查材料移除。",
        "Ctrl+Z恢复引用，再编辑后文。",
        "发送并核对身份。",
      ],
      expected: "正文删除与撤销同步同一材料，不出现幽灵引用、失效id或重复卡。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "delete-prefix-prose",
      name: "删除真实引用保留相似普通文字",
      section: "normal",
      condition: "完整首页空稿，不预置引用或提交。",
      steps: [
        "输入@选择README.md，打开预览后关闭。",
        "在末尾输入“请解释 @README.md.backup”，按Esc关闭候选。",
        "Ctrl+Home后Delete删除真正引用，再发送。",
        "在折叠的演示数据与事件核对home.submit及home.accepted。",
      ],
      expected:
        "保留完整普通backup文字，正式回调materials为空；不隐藏传递已删README。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "duplicate-adjacent",
      name: "重复引用与紧邻标点",
      section: "normal",
      condition: "从完整首页空稿选择README.md。",
      steps: [
        "选择后追加“@README.md.backup @README.md”，按Esc；只有后一个完整token成为同一材料的第二处引用。",
        "删除首处引用，发送前检查仍有一份材料；再删除最后一处并撤销，核对恢复。",
        "重新开始：选择README.md，删除其后的空格并紧接“，请解释”，继续编辑并发送。",
      ],
      expected:
        "跳过backup找到后续完整token；重复节点沿同一材料，最后一处删除才解除；真节点旁的标点不导致回填第二个引用。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "remove-adjacent",
      name: "移除不可用引用保留标点",
      section: "exception",
      condition: "空稿；第一次来源检查失败。",
      steps: [
        "通过@选择README.md，等待显示引用文件不可用。",
        "删除引用后的空格，紧接输入“，请解释”并按Esc。",
        "点击真实引用打开状态，选择移除引用；继续编辑并发送。",
        "重新开始检查docs目录不可用时的原因与重新检查。",
      ],
      expected:
        "移除按节点身份清正文及材料，保留标点/后文；继续编辑不从身份缓存复活，文件和目录各有具体检查反馈。",
      render: () => <HomeStoryExample scenario="prepare-error" />,
    },
    {
      id: "candidate-ranking",
      name: "名称优先与重名来源",
      section: "normal",
      condition:
        "空稿；演示候选含70个路径包含项、两个README.md与前缀/包含名称。",
      steps: [
        "输入@README.md，检查两个完全同名结果及相对来源在前，随后README.md.backup、copy-README.md.txt。",
        "选择z-last/README.md，继续编辑并发送；检查回调来源。",
        "重新开始，通过＋工作区文件搜索docs/，浏览直接子项并选择目录或含空格的长路径文件。",
      ],
      expected:
        "正式共享排序在截60项前保留完全匹配，重名来源可区分；目录下钻保持直接子项，含空格引用使用完整引号路径。",
      render: () => <HomeStoryExample scenario="file-ranking" />,
    },
    {
      id: "directory",
      name: "目录引用与下钻",
      section: "normal",
      condition: "docs为目录，有子文件。",
      steps: [
        "输入@找到docs。",
        "点击箭头下钻，再返回。",
        "点击docs行引用目录，继续输入文字。",
      ],
      expected: "箭头浏览和行引用区分；目录原子引用有效，准备/编辑身份仍同步。",
      render: () => <HomeStoryExample scenario="normal" />,
    },
    {
      id: "catalog-failure",
      name: "文件候选读取失败",
      section: "exception",
      condition: "首次目录请求失败。",
      steps: ["输入@查看失败与重试。", "重新读取后选择文件，继续编辑。"],
      expected: "读取失败不伪装无文件，恢复保留原正文。",
      render: () => <HomeStoryExample scenario="resource-error" />,
    },
    {
      id: "prepare-failure",
      name: "引用文件不可用",
      section: "exception",
      condition: "第一次文件来源检查失败。",
      steps: [
        "输入@选择文件。",
        "点击不可用引用打开具体原因并重新检查；再通过＋选择工作区文件，检查等待时正文只显示一个引用。",
        "继续编辑并尝试发送。",
      ],
      expected: "失败阻止提交；恢复不产生重复引用，原因归材料。",
      render: () => <HomeStoryExample scenario="prepare-error" />,
    },
    {
      id: "empty",
      name: "无文件或无匹配",
      section: "states",
      condition: "文件候选为空。",
      steps: [
        "输入@查看空结果。",
        "继续输入更具体路径并按Enter。",
        "Esc关闭候选后继续普通文字。",
      ],
      expected:
        "无匹配可调整查询，候选开启时Enter不提交；Esc后未选普通符号正文不凭@猜材料，真正已选材料未准备仍禁止发送。",
      render: () => <HomeStoryExample scenario="resource-empty" />,
    },
    {
      id: "reading",
      name: "候选读取中",
      section: "states",
      condition: "目录读取待解除。",
      steps: ["输入@，等待期间按Enter。", "按Alt+Shift+R完成等待，选择文件。"],
      expected: "Enter不误发送，解除后列表可选择。",
      render: () => <HomeStoryExample scenario="resource-pending" />,
    },
    {
      id: "preparing",
      name: "正在检查引用文件",
      section: "states",
      condition: "文件检查等待演示解除。",
      steps: [
        "输入@选择文件，继续编辑后文。",
        "检查等待时不可提交。",
        "在正文Ctrl+Home后Delete移除引用，再按Alt+Shift+R完成等待。",
        "Ctrl+Z恢复引用，再输入文字并发送，核对完整引用和文件材料。",
      ],
      expected:
        "等待明确显示正在检查文件；迟到结果不重添已删引用，撤销可恢复检查完成后的同一材料。",
      render: () => <HomeStoryExample scenario="prepare-pending" />,
    },
    {
      id: "long-path",
      name: "长文件路径",
      section: "states",
      condition: "只有含中文和空格的长路径文件；从空稿选择。",
      steps: [
        "输入@，检查候选名称和相对来源。",
        "选择后在390px预览继续输入。",
        "聚焦或预览读取完整来源。",
      ],
      expected: "引用可读、可删除、可补全来源，不能挤走工具栏。",
      render: () => <HomeStoryExample scenario="resource-long" />,
    },
  ],
  viewport: {
    width: 800,
    height: 680,
  },
} satisfies CatalogEntry
