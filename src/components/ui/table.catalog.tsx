import type { CatalogEntry } from "../../../ui-catalog/catalog"
import {
  Table,
  TableCaption,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
  TableFooter,
} from "./table"
export default {
  id: "table",
  name: "表格",
  layer: "基础组件",
  group: "数据展示",
  source: "src/components/ui/table.tsx",
  description: "shadcn Table；语义表格与局部横向滚动。",
  boundary: "不管理查询、分页或业务状态。",
  inputs: ["原生table及行/单元格属性"],
  events: ["由单元格中的交互控件提供"],
  composition: ["TableHeader、TableBody、TableFooter、TableCaption"],
  consumers: ["ConnectionList、ModelDirectory"],
  viewport: { width: 800, height: 300 },
  states: [
    {
      id: "default",
      name: "表头、行与汇总",
      condition: "固定列宽与长内容",
      expected: "表格语义完整，窄视口只在表格内滚动。",
      render: () => (
        <div className="p-6">
          <Table className="min-w-[560px]">
            <TableCaption>连接目录</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>连接</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>模型数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>OpenAI</TableCell>
                <TableCell>已配置</TableCell>
                <TableCell>3</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>本地推理服务</TableCell>
                <TableCell>无凭据</TableCell>
                <TableCell>0</TableCell>
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>总计</TableCell>
                <TableCell>3</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
