// RPC contract for the real Pi conversation lifecycle. Merged into schema.mjs.
const str = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const num = (description) => ({ type: "integer", minimum: 0, description })
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const ref = (name) => ({ $ref: name })
const arr = (items) => ({ type: "array", items })
const id = str("稳定的业务会话/请求标识", {
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9_-]+$",
})
const thinking = str("Pi 原生思考等级；不支持思考的模型只能使用 off", {
  enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
})
const tool = obj(
  {
    id: str("Pi toolCallId"),
    name: str("工具名称"),
    source: str("工具来源"),
    status: str("工具发生的实际状态；returned仅有结束证据而缺结果，不代表成功；unknown缺少可确认结论；not-run须有明确未执行证据，缺记录不作此证据", {
      enum: ["running", "success", "failed", "stopped", "not-run", "returned", "unknown"],
    }),
    input: str("序列化工具输入"),
    result: str("实际工具结果"),
    resultAvailability: str("当前投影的结果可用事实：available有真实最终结果（可为空、图片或截断，不保证已落盘）；partial仅有工具更新的部分结果；missing无可用结果。正式投影总提供，省略仅兼容未提供此事实的旧调用方，不能由空文本推断", {
      enum: ["available", "partial", "missing"],
    }),
    exitCode: {
      type: "integer",
      description: "Pi shell 实际退出码，0仅说明命令正常退出，不证明任务达成或结果正文已保存；未返回时省略，不从文本推断",
    },
    durationMs: {
      type: "number",
      minimum: 0,
      description: "Pi shell 实际 wall_time_seconds 换算为毫秒；未返回时省略",
    },
    occurrenceId: str("Pi assistant entryId与内容位置组成的调用身份；旧格式未持久迁移时使用稳定展示id，不冒充正式entryId；不以可重复的提供者toolCallId作为唯一键"),
    target: ref("ConversationToolTarget"),
    resultLength: num("Pi工具文本结果在Moon展示截断前的字符数；不是源文件总长度"),
    resultTruncated: {
      type: "boolean",
      description: "Pi结果本身或Moon展示结果发生截断；不能将展示文本当完整文件",
    },
    details: ref("ConversationToolDetails"),
    images: arr(ref("MaterialReference")),
    artifact: ref("ConversationFileArtifact"),
    presentation: ref("ExtensionPresentation"),
  },
  ["id", "name", "source", "status", "input", "result"]
)
// Internal index metadata shares this contract source, but is not a public DTO.
export const conversationRequestReceiptStorageSchema = obj(
  {
    sessionId: id,
    clientRequestId: id,
    fingerprint: str("内部：冻结请求SHA-256；不保存正文或凭据", {
      pattern: "^[a-f0-9]{64}$",
    }),
    status: str("preparing尚未提交启动；started与启动摘要原子提交；rejected明确未接受；handled由Pi公开回调确认已由扩展处理，不代表保存user消息", { enum: ["preparing", "started", "rejected", "handled"] }),
    ownerEpoch: str("登记准备的宿主身份；冷恢复不继续未完成准备", {
      minLength: 1,
    }),
    updatedAt: str("回执更新时点"),
    runId: id,
    issue: ref("OperationIssue"),
  },
  [
    "sessionId",
    "clientRequestId",
    "fingerprint",
    "status",
    "ownerEpoch",
    "updatedAt",
  ]
)
export const conversationSchemas = {
  ConversationRequestReceipt: obj({
    sessionId: id,
    clientRequestId: id,
    state: str("仅原请求的结论；accepted由正式Pi输入或已存队列证明，handled由明确保存的扩展处理回执证明；started缺权威证据始终unknown，不重发", { enum: ["accepted", "handled", "rejected", "unknown"] }),
    issue: ref("OperationIssue"),
  }, ["sessionId", "clientRequestId", "state"]),
  ConversationToolTarget: obj({
    kind: str("工具目标类型", { enum: ["file", "command"] }),
    path: str("按Pi参数和会话cwd解析的请求路径；预览另经realpath及目录边界核验"),
    displayPath: str("工作区内相对路径或完整外部路径"),
    requestedPath: str("Pi工具原始路径参数"),
    line: num("read请求的起始行，从1开始"),
    lineCount: num("read请求的行数"),
    command: str("Pi实际接收的命令参数"),
    cwd: str("命令所属会话工作目录"),
  }, ["kind"]),
  ConversationToolDetails: obj({
    diff: str("Pi edit实际成功结果的差异，不由模型正文或预计参数构造"),
    patch: str("Pi edit实际成功结果的unified patch"),
    firstChangedLine: num("Pi实际结果的首个改动行，从1开始"),
  }, []),
  ConversationFileArtifact: obj({
    path: str("成功的Pi文件操作目标路径，打开时仍须核对当前磁盘及权限边界"),
    displayPath: str("可读的文件目标"),
    operation: str("成功文件工具的实际操作；Pi无前像时只称write，不猜创建/覆盖", { enum: ["write", "edit"] }),
  }),
  ConversationChatTool: tool,
  ConversationRuntime: obj(
    {
      phase: str(
        "本次回复的实时执行阶段；只在 running 返回，不代表任务验收结果",
        {
          enum: ["responding", "tool", "retrying", "compacting"],
        }
      ),
      updatedAt: str("阶段发生时的 ISO 时间"),
      toolName: str("当前运行的 Pi 工具名称"),
      attempt: num("Pi 当前自动重试次数"),
      maxAttempts: num("Pi 本次自动重试上限"),
      retryAt: str("Pi 重试等待结束的 ISO 时间；等待结束后下一次事件更新阶段"),
      reason: str("固定安全原因，不包含提供者原始响应或凭据"),
      retrySource: str("自动重试属于回复请求还是上下文压缩", {
        enum: ["response", "compaction"],
      }),
    },
    ["phase", "updatedAt"]
  ),
  ConversationChatMessage: obj(
    {
      id: str("由 Pi 消息时间和顺序生成的稳定展示标识"),
      entryId: str(
        "原Pi历史已保存的权威条目标识；运行中消息或v1只读恢复的临时迁移标识不返回"
      ),
      historyIndex: {
        type: "integer",
        minimum: 0,
        description: "在完整Pi分支中的位置，包含custom条目；pending位于branch.length，继续指令使用原custom_message位置",
      },
      userTurnId: str("对应可见用户输入的稳定展示标识，用于聚合该输入之后的正式阶段；不是Pi fork锚点"),
      inputKind: str("可见用户输入的正式类型；不按正文文案猜继续请求", {
        enum: ["continuation"],
      }),
      continuationOf: str("可见继续指令所恢复的前一用户轮次；独立输入身份保留，便于标注历史attempt恢复关系"),
      runId: str("Moon正式请求标记提供的运行归属；旧记录缺失时省略，不推测"),
      stopReason: str("Pi正式assistant停止原因；length表示输出上限，不当作完整答案", { enum: ["stop", "length", "toolUse", "error", "aborted"] }),
      activeBlockId: str("Pi当前仍在生成的内容块；结束的thinking不随整条消息继续显示运行态"),
      forkable: {
        type: "boolean",
        description:
          "Pi已保存且完成的Agent回复边界，不含待执行工具调用；旧格式只读历史迁移前为false，来源会话还需通过控制门禁",
      },
      role: str("消息角色", { enum: ["user", "assistant"] }),
      text: str("消息文本"),
      time: str("ISO 时间"),
      model: str("实际模型"),
      status: str("消息状态", {
        enum: ["sending", "streaming", "settled", "interrupted", "failed"],
      }),
      issue: ref("OperationIssue"),
      thinking: obj({ text: str("Pi 实际返回的思考内容") }),
      materials: arr(ref("MaterialReference")),
      attachments: arr(
        obj({
          id: str("准备材料标识"),
          name: str("原始材料名称"),
          kind: str("展示类型", { enum: ["file", "image"] }),
          source: str("原始来源路径或固定图片说明"),
          materialType: str("材料真实类别", {
            enum: ["file", "directory", "image", "skill"],
          }),
        })
      ),
      tools: arr(ref("ConversationChatTool")),
      blocks: arr({
        anyOf: [
          obj({
            id: str("内容标识"),
            type: { type: "string", enum: ["text"] },
            text: str("文本"),
            phase: str("此块是否仍在生成", { enum: ["running", "settled"] }),
          }, ["id", "type", "text"]),
          obj({
            id: str("原始Pi内容位置生成的标识"),
            type: { type: "string", enum: ["thinking"] },
            text: str("该位置的Pi思考正文"),
            phase: str("此思考块的真实生成阶段", {
              enum: ["running", "settled"],
            }),
          }),
          obj({
            id: str("原始Pi内容位置生成的标识"),
            type: { type: "string", enum: ["image"] },
            image: ref("MaterialReference"),
          }),
          obj({
            id: str("内容标识"),
            type: { type: "string", enum: ["tool"] },
            tool: ref("ConversationChatTool"),
          }),
        ],
      }),
    },
    ["id", "role", "text", "time", "status"]
  ),
  ConversationSnapshot: {
    ...obj(
      {
        id,
        title: str("会话标题"),
        workspaceId: id,
        cwd: str("真实工作目录"),
        version: num("当前宿主单调更新版本，结合 epoch 判断新宿主"),
        epoch: str("宿主启动标识"),
        clientRequestId: str("最后提交启动的客户端请求标识；不是接受证明，未启动会话为空"),
        inputAccepted: {
          type: "boolean",
          description:
            "仅在 Pi 持久化方法成功返回后确认本次用户消息（或继续指令）已接受；消息事件本身不代表保存成功。false不推断拒绝，须核对原回执；handled表示扩展领取输入，仍不伪造user保存。相同标识不重复执行。",
        },
        inputDisposition: str("handled表示Pi公开入口确认扩展已处理本次输入；没有本次user接受证据，不能声称执行成功或重复提交", { enum: ["handled"] }),
        runId: str("本次或最后一次运行标识"),
        canContinue: {
          type: "boolean",
          description: "输入已接受且末次回复失败/停止或Pi length截断；继续是新的幂等可见指令，不重发原请求或自动执行旧工具",
        },
        phase: str(
          "真实回复运行状态；completed 仅表示本轮运行结束，不代表用户任务验收成功",
          {
            enum: [
              "idle",
              "running",
              "stopping",
              "completed",
              "failed",
              "interrupted",
            ],
          }
        ),
        modelId: str("连接 ID/模型 ID 的选择值"),
        connectionId: str("模型连接 ID"),
        providerModelId: str("服务端模型 ID"),
        thinking,
        error: str("错误说明，成功为空"),
        issue: ref("OperationIssue"),
        issueEntryId: str(
          "本次运行失败对应的正式 Pi 回复条目 ID；无对应回复时省略"
        ),
        messages: arr(ref("ConversationChatMessage")),
        permission: ref("ConversationPermission"),
        approvals: arr(ref("ConversationApproval")),
        statistics: ref("ConversationStatistics"),
        command: ref("ConversationCommandReceipt"),
        extensionNotifications: arr(
          obj({
            id,
            message: str("扩展提示"),
            severity: str("提示等级", { enum: ["info", "warning", "error"] }),
          })
        ),
        historyNotice: str(
          "旧格式历史的非阻断说明；只读恢复不持久化迁移标识，显式发送交由Pi迁移后恢复派生能力"
        ),
        queue: ref("ConversationQueue"),
        queueError: str("待处理消息保存或恢复错误；不会自动重发"),
        queueIssue: ref("OperationIssue"),
        control: ref("ConversationControl"),
        compactions: arr(ref("ConversationCompaction")),
        lineage: obj({
          sourceSessionId: id,
          sourceTitle: str("来源会话标题"),
          sourceEntryId: str("Pi来源回复标识"),
        }),
        runtime: ref("ConversationRuntime"),
        notice: obj({
          kind: str("非阻断执行提醒", { enum: ["compaction-failed", "input-handled"] }),
          message: str("安全说明；不把压缩失败等同任务失败"),
          occurredAt: str("提醒发生时的 ISO 时间"),
          runId: str("此提醒所属回复运行标识；新回复清除旧提醒"),
        }),
        context: obj(
          {
            usedTokens: num(
              "Pi getContextUsage 提供的上下文 token 估算，不等同完整请求或精确计费"
            ),
            contextWindow: num("当前模型上下文上限"),
            source: str("统计的权威来源", { enum: ["pi-context-estimate"] }),
            estimated: {
              type: "boolean",
              description: "Pi 统计为上下文估算，正式实现为 true",
            },
            observedAt: str("统计读取时点的 ISO 时间"),
            restored: {
              type: "boolean",
              description:
                "true 表示从正式历史恢复的已记录统计，并非当前实时请求",
            },
          },
          ["usedTokens", "contextWindow"]
        ),
        contextState: obj(
          {
            status: str("未知用量的原因分类；不会同时返回 context", {
              enum: ["awaiting-response", "unavailable"],
            }),
            contextWindow: num("已知的模型上下文上限"),
            observedAt: str("未知状态确认时点的 ISO 时间"),
            reason: str("未知用量的安全说明"),
          },
          ["status", "observedAt", "reason"]
        ),
      },
      [
        "id",
        "title",
        "workspaceId",
        "cwd",
        "version",
        "epoch",
        "clientRequestId",
        "inputAccepted",
        "runId",
        "phase",
        "modelId",
        "connectionId",
        "providerModelId",
        "thinking",
        "error",
        "messages",
      ]
    ),
    description:
      "运行结束仅表示本轮回复结束，任务应依据实际文件、命令和用户验收确认。执行阶段来自 Pi 官方事件；命令退出码不从文本猜测。上下文统计为 Pi 估算，标明统计时点；历史恢复的值不是当前请求统计，未知用量不会补成 0。",
  },
}
const selection = {
  connectionId: str("连接目录中的精确 ID", { minLength: 1, maxLength: 100 }),
  modelId: str("模型的精确 ID，允许斜杠", { minLength: 1, maxLength: 300 }),
  thinking,
}
const common = {
  module: "真实对话",
  response: ref("ConversationSnapshot"),
  result: "ConversationSnapshot",
  errors:
    "会话或工作区不存在、目录不可用、配置损坏、模型不可用、同一会话正在运行、请求标识冲突、存储失败。",
}
export const conversationOperations = {
  conversationReceiptRead: {
    module: common.module,
    method: "conversations.readReceipt",
    args: ["sessionId", "clientRequestId", "$signal"],
    request: obj({ sessionId: id, clientRequestId: id }),
    response: ref("ConversationRequestReceipt"),
    title: "只读核对原发送回执",
    input: ["sessionId", "clientRequestId"],
    result: "ConversationRequestReceipt",
    condition: "按原sessionId/clientRequestId核对，不要求会话摘要已创建；同会话锁等待准备结束，不激活Pi或重发输入。没有登记的请求、未能保存明确拒绝的当前preparing、损坏/缺失的权威历史保持unknown；started摘要本身不表示accepted或rejected。",
    effect: "index的preparing先于昂贵准备，started与启动摘要原子提交；明确拒绝及公开Pi入口的handled按本request单独保存。handled仅确认扩展领取本次输入，不代表命令成功或保存user。旧宿主的preparing证明未启动；accepted须有正式Pi用户输入/可见继续指令或持久队列证明，已接受的历史身份不随当前分支变化而消失。started无本次accepted/handled/rejected权威证据始终unknown，包括已有历史、缺首文件和handled保存失败，原ID不重执行。只返回身份与安全结论，不返回输入、材料或fingerprint，不改写历史或回执。",
    errors: "回执索引或正式历史损坏、存储不可访问、请求已取消；错误不确认拒绝，不自动重复外部效果。",
    example: { sessionId: "sample-session", clientRequestId: "sample-request" },
  },
  conversationSend: {
    ...common,
    method: "conversations.send",
    args: [
      "sessionId",
      "workspaceId",
      "clientRequestId",
      "text",
      "connectionId",
      "modelId",
      "thinking",
      "materials",
      "$signal",
      "delivery",
    ],
    title: "发送真实多轮消息",
    input: [
      "sessionId",
      "workspaceId",
      "clientRequestId",
      "text",
      "connectionId",
      "modelId",
      "thinking",
    ],
    request: obj(
      {
        sessionId: id,
        workspaceId: id,
        clientRequestId: id,
        text: str("本轮用户文本；有就绪材料时可以为空", { maxLength: 100000 }),
        materials: arr(ref("MaterialReference")),
        delivery: str("运行中Enter的交付方式，空闲始终正常发送", {
          enum: ["followUp", "steer"],
        }),
        ...selection,
      },
      [
        "sessionId",
        "workspaceId",
        "clientRequestId",
        "text",
        "connectionId",
        "modelId",
        "thinking",
      ]
    ),
    condition:
      "需保存工作区、会话配置与可用模型；空闲时启动，运行中原子保存至本会话待处理队列，不并行推理。clientRequestId冻结内容幂等；已接受请求不再执行，started但未确认输入的重复请求要求只读核对，明确拒绝的原ID不重放。队列acceptedRequestIds表示已保存待处理输入，与Pi inputAccepted区分。控制操作运行中、结果未确认或停止中拒绝新提交。启动提交前取消不开始推理，可能保留准备回执和已建空会话；启动提交后需Stop明确停止，不因断开轮询取消。",
    effect:
      "空闲正文原样交公开Pi prompt默认解析，Skill由Pi原生加载；图片随同一输入传入，核对后的文件/目录路径说明通过before_agent_start的隐藏上下文提供，不遮住leading命令。正式user对象保存成功后确认inputAccepted，并将原文及材料身份元数据绑定该user。Pi公开回调handled明确保存后返回inputDisposition=handled，释放原提交但不伪造user接受或命令成功。未确认时按原ID只读ReceiptRead，不凭终态重放。运行/冷队列保留已有准备与交付协议，未在本次迁移。后台推理及工具可能产生费用并修改所选目录。",
    example: {
      sessionId: "sample-session",
      workspaceId: "sample-workspace",
      clientRequestId: "sample-request",
      text: "列出当前目录的文件",
      connectionId: "sample",
      modelId: "sample-model",
      thinking: "off",
    },
  },
  conversationRead: {
    ...common,
    method: "conversations.read",
    args: ["sessionId", "afterVersion", "$signal"],
    title: "读取对话与流式进度",
    input: ["sessionId"],
    request: obj(
      {
        sessionId: id,
        afterVersion: num("可选：客户端已见版本；本版始终返回完整快照"),
      },
      ["sessionId"]
    ),
    condition:
      "不触发推理；每 200–300ms 轮询，失败保留旧画面；epoch 改变时接纳新宿主快照。读取不标记已读，不迁移或修复磁盘 JSONL。非空行 JSON 损坏、文件头无效、工作目录不匹配或历史版本过新时明确拒绝，原文件不改写。",
    effect:
      "通过 Pi 官方内存 SessionManager 恢复合法历史及分支；v1/v2 只在内存迁移，缺少末尾换行不补写；正式发送才交由 Pi 打开持久化历史并迁移。模型配置或工作目录被移除仍可查看已存消息。完整historyIndex与有序thinking/text/tool/image块来自Pi；工具差异来自正式details，图片进入既有材料缓存并只传材料引用，不反复传base64。runtime仅表示当前执行阶段；context是Pi估算，重启统计标记restored。工具状态与resultAvailability独立；真实结果和结束进度优先，缺正文的shell结束记录非0保failed、0或仅耗时为returned，没有结果、进度或对应停止证据时为unknown，缺记录不判not-run。shell可含实际exitCode/durationMs，不补造输出、不自动重跑、不改写旧历史。",
    errors:
      "会话不存在、历史不存在或无法读取、历史 JSON 或文件头损坏、工作目录元数据不匹配、历史版本高于当前 Pi 支持版本；失败不会覆盖原历史。",
    example: { sessionId: "sample-session" },
  },
  conversationStop: {
    ...common,
    method: "conversations.stop",
    args: ["sessionId", "runId", "$signal"],
    title: "停止本次生成",
    input: ["sessionId", "runId"],
    request: obj({ sessionId: id, runId: id }),
    condition:
      "runId 必须匹配；重复停止幂等；设置 stopping 后后台等待 Pi abort 完成。",
    effect: "停止模型与工具，保留已写入消息和真实工具结果，不回滚已执行操作。",
    example: { sessionId: "sample-session", runId: "sample-run" },
  },
  conversationRetry: {
    ...common,
    method: "conversations.retry",
    args: [
      "sessionId",
      "clientRequestId",
      "connectionId",
      "modelId",
      "thinking",
      "$signal",
    ],
    title: "继续上次未完成回复",
    input: [
      "sessionId",
      "clientRequestId",
      "connectionId",
      "modelId",
      "thinking",
    ],
    request: obj({ sessionId: id, clientRequestId: id, ...selection }),
    condition:
      "仅失败、中断或最后Pi回复stopReason=length的空闲会话，且没有运行中或结果未确认的控制操作；本轮inputAccepted必须为true且需要已有用户历史，clientRequestId幂等。预检未接受输入时须保留草稿重新发送，旧用户历史不能代替本轮接受边界。不重发原始用户请求，不自动重放已成功工具。",
    effect:
      "通过 Pi sendCustomMessage 添加可见的继续指令后发起下一轮，保留先前回复与工具结果。",
    example: {
      sessionId: "sample-session",
      clientRequestId: "sample-retry",
      connectionId: "sample",
      modelId: "sample-model",
      thinking: "off",
    },
  },
}
