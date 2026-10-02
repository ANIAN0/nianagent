import { ModelDirectoryExample } from "../../../ui-catalog/fixtures/model-settings"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import "./model-settings.css"
export default {
  id: "discovered-models",
  name: "发现候选模型",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/model-directory.tsx",
  description: "测试连接后选择新增模型；已加入模型不能重复添加。",
  boundary: "通过参数与事件传递数据；服务由宿主注入，展示与正式数据隔离。",
  inputs: ["models", "existing", "busy"],
  events: ["onAdd(models)"],
  composition: ["Table", "Checkbox", "SettingsPagination"],
  consumers: ["ConnectionEditor"],
  viewport: { width: 1000, height: 720 },
  states: [
    {
      id: "default",
      name: "候选选择",
      condition: "首个模型已加入；包含匹配、部分冲突、未知来源",
      expected: "展示来源及待确认项；选中、计数、加入后禁用防重复",
      render: () => <ModelDirectoryExample candidates />,
    },
  ],
} satisfies CatalogEntry
