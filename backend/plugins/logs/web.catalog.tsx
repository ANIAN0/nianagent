import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { Page } from "./web"
import type { LogEntry, LogsClient } from "./types"
function Example({
  empty = false,
  failure = false,
}: {
  empty?: boolean
  failure?: boolean
}) {
  const [source] = useState<LogsClient>(() => {
    const entries: LogEntry[] = Array.from(
      { length: empty ? 0 : 75 },
      (_, index) => ({
        id: `example-${index}`,
        time: new Date(1792266000000 + index * 1000).toISOString(),
        source: "tool",
        plugin: "opencli",
        tool: "opencli__run",
        status: index % 3 ? "succeeded" : "failed",
        durationMs: 1250,
        callId: `example-call-${index}`,
        client: "未提供",
        input: JSON.stringify({
          argumentCount: 5,
          lengths: [7, 9, 4, 16, 600],
        }),
        result: JSON.stringify({ content: [{ type: "text", length: 2300 }] }),
        error: index % 3 ? "" : "插件连接不可用；未保存原始stderr。",
      })
    )
    return {
      query: async (input) => {
        if (failure) throw new Error("示例：日志存储暂不可读。")
        const items = entries.filter(
          (item) =>
            (!input.plugin || input.plugin === item.plugin) &&
            (!input.tool || input.tool === item.tool) &&
            (!input.status || input.status === item.status) &&
            (!input.from || item.time >= input.from) &&
            (!input.to || item.time <= input.to)
        )
        return {
          entries: items.slice(input.offset, input.offset + input.limit),
          total: items.length,
          offset: input.offset,
          limit: input.limit,
          issue: "",
          retention: { days: 30, maxEntries: 10000, maxBytes: 8388608 },
        }
      },
      detail: async (id) => ({
        entry: entries.find((entry) => entry.id === id)!,
        issue: "",
      }),
    }
  })
  return (
    <div className="p-6">
      <Page service={source} />
    </div>
  )
}
export default {
  id: "moon-external-logs",
  name: "MCP 与工具日志页",
  layer: "页面",
  stage: "content",
  order: 184,
  pages: ["插件设置"],
  group: "插件设置",
  source: "backend/plugins/logs/web.tsx",
  relatedOperations: ["logs.query", "logs.detail"],
  modules: [
    { id: "plugin-settings", region: "日志筛选、分页列表与安全摘要详情" },
  ],
  description: "正式日志页筛选、分页并查看调用ID与安全摘要。",
  boundary: "隔离服务只持内存示例，不查询或改写宿主日志。",
  story: {
    goal: "找到对外调用并核对结束状态。",
    preconditions: ["日志插件页面已打开。"],
    result: "筛选结果、分页与详情对应同一请求，不接纳迟到结果。",
  },
  standards: [
    {
      id: "L1",
      name: "记录与查看分开",
      rule: "关闭查看插件仍由宿主写入。",
      reason: "记录属于调用边界。",
      check: "正式流程关闭日志插件、调用共享工具，再启用查询。",
    },
  ],
  inputs: ["LogsClient"],
  events: ["筛选/刷新/分页", "打开与关闭详情"],
  composition: [
    "Field / Input / Select / Table / Badge / Dialog / Empty / Alert",
  ],
  consumers: ["PluginSettings"],
  viewport: { width: 760, height: 900 },
  states: [
    {
      id: "browse",
      name: "筛选分页与详情",
      section: "normal",
      condition: "75条隔离日志。",
      expected: "筛选重置页码，详情显示安全摘要与自报说明。",
      steps: [
        "选择失败状态并筛选。",
        "查看一条详情，再关闭。",
        "重置后翻至下一页。",
      ],
      render: () => <Example />,
    },
    {
      id: "empty",
      name: "空结果",
      section: "states",
      condition: "没有日志。",
      expected: "空说明与筛选入口保留。",
      steps: ["核对空结果并刷新。"],
      render: () => <Example empty />,
    },
    {
      id: "failure",
      name: "读取失败",
      section: "exception",
      condition: "存储读取失败。",
      expected: "明确错误，刷新入口可用。",
      steps: ["核对错误并刷新。"],
      render: () => <Example failure />,
    },
  ],
} satisfies CatalogEntry
