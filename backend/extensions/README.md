# Moon 本地扩展 API 1

这是随应用发布的受信本地代码入口，使用 Pi 1.0 的具名 `extensionFactories` 和 `registerTool`。它不是工作区脚本加载器或代码沙箱。宿主不会向模块传入 Pi、SessionManager、模型凭据或发送接口；模块不得接管发送、队列与历史。这些职责仍由 Pi 和 Moon 正式服务负责。

新增模块只需新增 `backend/extensions/modules/<稳定id>/manifest.mjs`，默认导出下列声明；不要修改核心操作分派或按模块名称增加条件分支。ID 使用小写字母开头、字母数字连字符，最长 24 字符，目录名与声明 ID 一致。

```js
export default {
  apiVersion: 1,
  id: "your-module",
  version: "1.0.0",
  name: "模块名称",
  description: "功能与适用场景",
  configurationVersion: 1,
  configurationSchema: { /* 严格对象 JSON Schema */ },
  defaultConfiguration: { /* 经过该 schema 校验 */ },
  resultKinds: [{ kind: "moon.your-result", version: 1, schema: { /* 严格对象 schema */ } }],
  tools: [{
    id: "tool", label: "工具名称", description: "模型可理解的用途",
    parameters: { /* 严格对象 JSON Schema；Pi 负责调用参数校验 */ },
    async execute({ toolCallId, arguments: input, cwd, configuration, signal, resources, onUpdate }) {
      signal.throwIfAborted()
      return {
        content: [{ type: "text", text: "真实结果；也是未知展示版本时的回退" }],
        presentation: { kind: "moon.your-result", version: 1, data: { /* 对应结果 schema */ } },
      }
    },
  }],
}
```

配置是应用级持久数据，保存至应用数据目录的 `extensions/configuration.json`。未保存的模块默认停用。`extensionList` 返回声明、配置 schema、默认值和 CAS revision；字段 `title`、`description`、`default`供设置界面使用。`extensionConfigure` 携带原 revision，锁内比较并原子提交。可选原 `operationRequestId` 用于 `writeReceiptRead` 只读确认结果；未知结果不以配置相等推断提交，不重新执行原操作。

配置快照在当前已接受轮次保持不变，下一次空闲发送重载；停用不会偷偷清除会话的工具选择，失效选择会阻止发送并要求用户处理。配置协议变更应提升 `configurationVersion`，旧配置会明确报错；宿主不猜测迁移数据。当前 API 1 工具参数、配置和结果都要求对象 schema；配置与结果禁止静默类型转换。

正式工具 ID 自动生成为 `moon_ext__your_module__tool`，与其他模块和 MCP 工具隔离。工具还需在会话配置中选中后才启用。`executionMode` 可选 `parallel` 或 `sequential`；不指定时使用 Pi 默认调度。

需要连接等资源时声明可选 `async createSession({cwd,configuration,signal})`，返回工具使用的资源对象；该对象可提供 `async dispose()`。资源仅在该正式会话首次执行工具时创建，目录读取不创建资源。必须响应 `signal`，部分初始化失败须自行释放已取得的资源。工具取消立即结束该调用的等待；只有尚未取得资源且最后一名等待者取消时，宿主才中止初始化并收尾迟到资源。已取得的共享资源保留到重载或关闭，其他等待调用不受影响。后继初始化等待前次收尾，重复释放幂等。会话和应用退出会等待全部收尾；受信进程内代码必须合作响应取消，宿主无法强杀单个 JavaScript 调用。普通工具错误隔离到该次调用；释放失败使该模块失效，需重启后恢复。

`content` 是 Pi 正式工具结果，`presentation` 只增加展示。展示数据须匹配声明 kind/version/schema，最多 64 KiB；`details.moonPresentation` 与 `details.moonExtension` 为宿主保留字段，不得自行写入。宿主将已校验展示与模块来源保存在 Pi 官方 JSONL 的 details，实时与冷历史使用相同恢复逻辑。停用或移除模块仍能读取已有结果；未知展示版本回退原结果文本。任何 Pi/MCP 工具不能借用扩展展示 envelope。

新增展示时，前端模块以 `src/extensions/<模块>/manifest.json` 声明 kind/version 与同目录的 `*-result.tsx` 组件。组件由正式构建发现并按需加载；宿主只传入结构化payload、冻结的工具摘要与受控路径预览，不提供发送、队列、凭据或历史接口。声明冲突、未知版本和展示失败保留原结果，不改工具状态、不重发工具。正式发布与版本指纹递归包含 `extensions/**/*.mjs`；当前固定正式目录只支持 `.mjs` 与 `.md`，不得放入用户数据、临时文件或目录外链接。


```json
{"results":[{"kind":"moon.note","version":1,"component":"note-result.tsx"}]}
```

前端参数以 `src/features/extensions/result-renderers.ts` 的 `ResultRendererProps` 为准。参照 `src/extensions/example-note/` 和相邻 `tool-result-presentation.catalog.tsx`；组件目录只呈现隔离记录。真实接入必须在扩展能力中保存启用，再在会话配置选择工具，验证模型调用、停止、下一轮配置加载与重开历史。正式 RPC 字段、取消和错误说明由 `/api-catalog/` 生成。
