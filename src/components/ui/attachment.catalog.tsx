import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "attachment",
  name: "附件",
  source: "src/components/ui/attachment.tsx",
  group: "内容与反馈",
  layer: "基础组件",
  order: 26,
  pages: ["首页"],
  stage: "content",
  description:
    "表达图片缩略、普通文件信息及所属准备/失败状态，提供独立预览和移除动作。",
  boundary:
    "工作区文件/目录采用正文原子引用，选择的普通文件可保附件卡；Skill仅普通正文，无附件身份。基础状态不代替完整添加与提交流程。",
  standards: [
    {
      id: "M1",
      name: "材料形式有依据",
      rule: "图片缩略与选择的普通文件信息共处附件轨道；工作区引用已有正文位置，Skill普通文字不重复成卡，状态说明属于该材料。",
      reason: "图片需预览；文字引用已经在正文中有对象位置。",
      check: "核对正式文件/Skill例，不用单个基础卡证明复合流程通过。",
    },
    {
      id: "M2",
      name: "独立操作",
      rule: "预览覆盖主体，移除/重试独立；corner动作统一右上4px，overlay移除使用同24px尺寸与底色，文件为动作留空间。长名不推走动作，失败就地恢复；默认动作布局保持。",
      reason: "用户需要分别查看和移除，不应一次点击同时触发两者。",
      check: "点击主体与移除分别检查事件；准备中、失败、长名布局。",
    },
  ],
  inputs: [
    "state: idle / uploading / processing / error / done",
    "Media / Content / Title / Description；Trigger预览与Action移除分离",
    "Actions placement: default / corner；Action appearance: default / overlay，默认调用不变",
  ],
  events: ["预览、重试和移除各发独立事件；不改变正文身份"],
  composition: [
    "直接复用 src/components/ui/attachment.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "mixed",
      name: "输入混合轨道公共动作",
      section: "normal",
      condition:
        "完整Home空稿，通过正式MaterialChip使用corner/overlay；图片和文件均实际选择。",
      steps: [
        "加号添加附件，在轨道查看图片缩略与文件名称/大小。",
        "分别点击主体预览并关闭，再用右上移除按钮移除图片与文件。",
        "核对其他材料/正文仍在，窄窗可滚动到末尾材料。",
      ],
      expected:
        "两类64px高、12px圆角边框；右上24px移除同外观，名称留空间，移除不误预览或提交。",
      render: () => <BasicControlExample kind="attachment" mode="mixed" />,
    },
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: [
        "点击主体预览，核对事件。",
        "点击移除，确认没有触发预览。",
        "恢复示例再次检查。",
      ],
      expected: "预览和移除独立，长名不挤掉动作。",
      render: () => <BasicControlExample kind="attachment" mode="normal" />,
    },
    {
      id: "processing",
      name: "准备中",
      section: "states",
      condition: "通过参数给出对应状态，示例不调用真实后端。",
      steps: ["查看准备状态，点击完成准备。", "分别预览和移除。"],
      expected: "准备状态属于附件；完成后说明更新，动作独立。",
      render: () => <BasicControlExample kind="attachment" mode="processing" />,
    },
    {
      id: "error",
      name: "失败与恢复",
      section: "exception",
      condition: "通过参数给出对应状态，示例不调用真实后端。",
      steps: ["查看失败附件和局部说明。", "点击重试准备，再点击移除。"],
      expected: "错误能定位到对象并恢复；没有重复提示或假成功。",
      render: () => <BasicControlExample kind="attachment" mode="error" />,
    },
    {
      id: "long",
      name: "长内容与窄窗",
      section: "states",
      condition: "较长内容仅核对边界，不作为业务主流程证据。",
      steps: [
        "在390px和常规视口查看较长内容。",
        "点击主体预览，核对事件。",
        "点击移除，确认没有触发预览。",
        "恢复示例再次检查。",
      ],
      expected: "内容在所属区域收缩、换行或滚动，操作和完整信息仍可到达。",
      render: () => <BasicControlExample kind="attachment" mode="long" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
