import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "empty",
  name: "空状态",
  source: "src/components/ui/empty.tsx",
  group: "内容与反馈",
  layer: "基础组件",
  order: 30,
  pages: ["首页"],
  stage: "content",
  description: "表达无候选、无匹配或列表读取失败的不同结果。",
  boundary: "空集合与错误不能混为一谈；恢复按钮只针对对应原因。",
  standards: [
    {
      id: "Z1",
      name: "分清空与失败",
      rule: "无匹配建议改查询/筛选；读取失败提供重读，不能写暂无数据掩盖故障。",
      reason: "用户需要知道能否通过修改输入恢复。",
      check: "比较空和错误例，文案与动作不同。",
    },
    {
      id: "Z2",
      name: "简洁局部反馈",
      rule: "状态在列表内容区，不重复正文提示、不添加与任务无关插画。",
      reason: "空状态只帮助继续当前选择。",
      check: "清除搜索恢复列表，保留已选项。",
    },
  ],
  inputs: [
    "Header / Media / Title / Description / Content",
    "标题解释当前结果，动作关联读取或筛选",
  ],
  events: ["清除筛选或重新读取由所属列表实现"],
  composition: [
    "直接复用 src/components/ui/empty.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["读到无匹配说明，点击清除筛选。"],
      expected: "空结果的原因与动作对应，事件只由真实按钮触发。",
      render: () => <BasicControlExample kind="empty" mode="normal" />,
    },
    {
      id: "error",
      name: "失败与恢复",
      section: "exception",
      condition: "通过参数给出对应状态，示例不调用真实后端。",
      steps: ["查看失败说明与恢复动作。", "点击恢复，查看演示事件。"],
      expected: "错误能定位到对象并恢复；没有重复提示或假成功。",
      render: () => <BasicControlExample kind="empty" mode="error" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
