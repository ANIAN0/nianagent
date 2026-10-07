import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "table",
  name: "表格",
  source: "src/components/ui/table.tsx",
  group: "数据展示",
  layer: "基础组件",
  order: 26,
  pages: ["首页", "模型设置", "MCP设置"],
  stage: "content",
  description: "以共同列轴组织名称、说明、来源及操作。",
  boundary: "表格负责结构与共享规格；筛选、选择集合、详情和保存由调用方管理。",
  standards: [
    {
      id: "T1",
      name: "完整表格结构",
      rule: "使用TableHeader/Body/Row/Head/Cell完整组合，表头和数据同列；复选框及操作按单元格居中。",
      reason: "来源与操作不能随名称长度漂移。",
      check: "普通与长内容核对四列和键盘操作，名称label仍能勾选。",
    },
    {
      id: "T2",
      name: "显式紧凑规格",
      rule: "default保持原14px正文、40px表头及单元格内距；compact为13px/20px正文、32px及12px/18px表头、单元格左右8px上下12px。secondary单元格和TableCellDescription为12px/18px。",
      reason: "业务页采用共享规格，其他默认表格不受新变体影响。",
      check: "对比default与compact；在390px窗口查看长名称、说明和来源自然换行。",
    },
  ],
  inputs: [
    "Table variant: default | compact；默认default",
    "TableCell variant: default | secondary；默认default",
    "TableCellDescription承载次级说明；列宽、选择和动作由调用方提供",
  ],
  events: ["交互来自单元格内正式Checkbox与Button，Table本身不修改业务状态"],
  composition: ["Table / TableHeader / TableBody / TableRow / TableHead / TableCell / TableCellDescription / Checkbox / Button"],
  consumers: ["ToolPicker", "模型连接与模型目录", "MCP服务列表"],
  states: [
    {
      id: "normal",
      name: "默认表格",
      section: "normal",
      condition: "未指定compact，保持现有默认规格。",
      steps: ["勾选读取文件或点击名称。", "点击详情，核对演示事件；Tab切换交互。"],
      expected: "表头和单元格同列，默认字号与间距不因新增compact改变。",
      render: () => <BasicControlExample kind="table" mode="normal" />,
    },
    {
      id: "compact",
      name: "紧凑表格与长内容",
      section: "states",
      condition: "显式compact，完整四列表格含长名称、长来源和多行说明。",
      steps: ["在常规和390px窗口核对名称、来源、说明换行和行高。", "勾选读取文件并点击详情，检查完整名称及可达操作。"],
      expected: "正文13px/20px，次级说明12px/18px，行随内容增高；列轴、勾选和操作保持可达。",
      render: () => <BasicControlExample kind="table" mode="compact" />,
    },
    {
      id: "long",
      name: "默认长内容",
      section: "states",
      condition: "default保留原单元格nowrap和表格局部横向滚动。",
      steps: ["在窄窗横向滚动表格。", "找到操作列并点击详情。"],
      expected: "默认表格在自身容器横向滚动，不撑宽页面；未被compact换行规则覆盖。",
      render: () => <BasicControlExample kind="table" mode="long" />,
    },
  ],
  viewport: { width: 640, height: 420 },
} satisfies CatalogEntry
