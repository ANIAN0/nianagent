const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

export const telemetrySchemas = {
  FrontendPerfKind: {
    type: "string",
    enum: ["loaf", "longtask", "event-timing", "render", "inp"],
    description:
      "前端性能事件类型。event-timing 表示单条 Event Timing 样本；inp 是旧客户端的同义输入，新增日志使用 event-timing。",
  },
  FrontendPerfEvent: object(
    {
      kind: { $ref: "FrontendPerfKind" },
      name: {
        type: "string",
        minLength: 1,
        maxLength: 120,
        description:
          "事件名称（Event Timing 样本为 click、keydown 等浏览器事件名）",
      },
      durationMs: {
        type: "integer",
        minimum: 0,
        maximum: 600000,
        description:
          "样本持续时间（毫秒）。Event Timing 记录浏览器报告的单条事件持续时间。",
      },
      blockingMs: {
        type: "integer",
        minimum: 0,
        maximum: 600000,
        description: "主线程阻塞耗时（毫秒）",
      },
      route: {
        type: "string",
        maxLength: 120,
        description: "采集时的页面视图标识",
      },
      detail: {
        type: "string",
        maxLength: 300,
        description: "简短归因信息（如脚本或函数名）",
      },
    },
    ["kind", "name", "durationMs"]
  ),
  FrontendPerfReportRequest: object({
    events: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: { $ref: "FrontendPerfEvent" },
      description: "待写入本机诊断日志的前端性能事件批次",
    },
  }),
  FrontendPerfReportResult: object({
    accepted: {
      type: "integer",
      minimum: 0,
      description:
        "本批交给本机诊断写入器的样本条数；日志异步落盘，重复样本可能合并。",
    },
  }),
}

export const telemetryOperations = {
  telemetryReportPerf: {
    module: "性能诊断",
    method: "telemetry.reportPerf",
    args: ["events"],
    request: { $ref: "FrontendPerfReportRequest" },
    response: { $ref: "FrontendPerfReportResult" },
    title: "上报前端性能卡顿样本",
    input: ["events"],
    result: "FrontendPerfReportResult",
    condition:
      "只写入本机诊断日志（logs/moon-node.jsonl），不修改业务配置或会话状态；单批最多 50 条。",
    errors: "请求参数不合法。",
    effect:
      "按白名单字段将前端性能样本写入本机诊断日志。开发页面采集至少 100 ms 的单条 Event Timing 样本；在日志插件按 frontend-perf 查询，事件名为 perf.event-timing.<浏览器事件名>，已有 perf.inp.* 记录保留原名。",
    example: {
      events: [
        {
          kind: "event-timing",
          name: "click",
          durationMs: 128,
          route: "/",
        },
      ],
    },
  },
}
