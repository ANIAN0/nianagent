// MCP 与内置 Pi 共用的工作台工具目录及效果声明。
export const readOnlyTools = new Set([
  "list_projects",
  "list_directories",
  "list_drafts",
  "list_versions",
  "read_version",
  "list_targets",
  "read_asset",
  "compare_versions",
  "read_thread",
  "list_threads",
  "open_version",
])

export const toolOperations = [
  "v2_list_projects:list_projects",
  "v2_create_project:create_project",
  "v2_update_project:update_project",
  "v2_list_directories:list_directories",
  "v2_create_directory:create_directory",
  "v2_update_directory:update_directory",
  "v2_create_draft:create_draft",
  "v2_list_drafts:list_drafts",
  "v2_update_draft:update_draft",
  "v2_stage_package:stage_package",
  "v2_publish_version:publish_version",
  "v2_list_versions:list_versions",
  "v2_read_version:read_version",
  "v2_list_targets:list_targets",
  "v2_read_asset:read_asset",
  "v2_compare_versions:compare_versions",
  "v2_create_thread:create_thread",
  "v2_add_reply:add_reply",
  "v2_set_thread_status:set_thread_status",
  "v2_list_threads:list_threads",
  "v2_read_thread:read_thread",
  "v2_open_version:open_version",
]

const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const str = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const int = (description, extra = {}) => ({
  type: "integer",
  description,
  ...extra,
})
const bool = (description) => ({ type: "boolean", description })
const listOf = (description) => ({
  type: "array",
  items: { type: "object" },
  description,
})

export const noteOperations = {
  v2_create_project: {
    title: "创建工作台项目",
    owner: "workbench",
    input: obj({
      name: str("项目名", { maxLength: 64 }),
      requestKey: str("请求键（幂等；同键异输入拒绝）", {
        minLength: 1,
        maxLength: 128,
      }),
    }),
    output: obj({
      value: obj({
        id: str("项目标识"),
        name: str("项目名"),
        replayed: bool("是否为重放结果"),
      }),
    }),
    effect: "写入：新建项目；重放核对完整输入签名。",
  },
  v2_update_project: {
    title: "更新工作台项目",
    owner: "workbench",
    input: obj(
      {
        projectId: str("项目标识", { minLength: 1 }),
        name: str("新名称；可空", { maxLength: 64 }),
        archived: bool("归档(true)/恢复(false)；可空"),
        requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
      },
      ["projectId", "requestKey"]
    ),
    output: obj({
      value: obj({
        id: str("项目标识"),
        name: str("名称"),
        archived: bool("是否归档"),
        replayed: bool("是否为重放结果"),
      }),
    }),
    effect: "写入：改名与归档/恢复；请求身份幂等。",
  },
  v2_list_projects: {
    title: "列出工作台项目",
    owner: "workbench",
    input: obj(
      {
        cursor: str("分页游标（keyset，服务端签发原样回传）；可空", {
          maxLength: 256,
        }),
        archived: bool("包含已归档项目；缺省仅未归档（AC18 一致归档语义）"),
      },
      []
    ),
    output: obj({
      value: obj({
        items: listOf("项目"),
        complete: bool("本页是否完整"),
        nextCursor: {
          type: ["string", "null"],
          description: "下一页 keyset 游标",
        },
      }),
    }),
    effect:
      "读取：项目列表（keyset 分页；默认仅未归档，恢复浏览显式传 archived）。",
  },
  v2_create_directory: {
    title: "创建工作台目录",
    owner: "workbench",
    input: obj(
      {
        projectId: str("项目标识", { minLength: 1 }),
        parentId: str("父目录标识；空字符串为根", { maxLength: 64 }),
        name: str("目录名", { maxLength: 64 }),
        requestKey: str("请求键（幂等；同键异输入拒绝）", {
          minLength: 1,
          maxLength: 128,
        }),
      },
      ["projectId", "name", "requestKey"]
    ),
    output: obj({
      value: obj({
        id: str("目录标识"),
        name: str("目录名"),
        replayed: bool("是否为重放结果"),
      }),
    }),
    effect: "写入：新建目录；重放核对完整输入签名。",
  },
  v2_update_directory: {
    title: "更新工作台目录",
    owner: "workbench",
    input: obj(
      {
        directoryId: str("目录标识", { minLength: 1 }),
        parentId: {
          type: ["string", "null"],
          maxLength: 64,
          description: "新父目录；null 移到项目根，省略则不移动",
        },
        name: str("新名称；可空", { maxLength: 64 }),
        archived: bool("归档(true)/恢复(false)；可空"),
        requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
      },
      ["directoryId", "requestKey"]
    ),
    output: obj({
      value: obj({
        id: str("目录标识"),
        name: str("名称"),
        parentId: { type: ["string", "null"], description: "父目录" },
        archived: bool("是否归档"),
        replayed: bool("是否为重放结果"),
      }),
    }),
    effect: "写入：改名/移动/归档/恢复；目录环明确拒绝。",
  },
  v2_list_directories: {
    title: "列出项目目录",
    owner: "workbench",
    input: obj(
      {
        projectId: str("项目标识", { minLength: 1 }),
        cursor: str("分页游标（keyset）；可空", { maxLength: 256 }),
        archived: bool("包含已归档目录；缺省仅未归档（AC18 一致归档语义）"),
      },
      ["projectId"]
    ),
    output: obj({
      value: obj({
        items: listOf("目录（含完整归属）"),
        complete: bool("本页是否完整"),
        nextCursor: {
          type: ["string", "null"],
          description: "下一页 keyset 游标",
        },
      }),
    }),
    effect: "读取：目录列表（keyset 分页，含归属；默认仅未归档）。",
  },
  v2_create_draft: {
    title: "创建工作台草稿",
    owner: "workbench",
    input: obj({
      directoryId: str("目录标识", { minLength: 1 }),
      kind: str("草稿类型：markdown/board/ui", { maxLength: 8 }),
      title: str("草稿标题", { maxLength: 120 }),
      requestKey: str("请求键（幂等；同键异输入拒绝）", {
        minLength: 1,
        maxLength: 128,
      }),
    }),
    output: obj({
      value: obj({
        id: str("草稿标识"),
        kind: str("类型"),
        replayed: bool("是否为重放结果"),
      }),
    }),
    effect: "写入：新建草稿；重放核对完整输入签名。",
  },
  v2_update_draft: {
    title: "更新工作台草稿",
    owner: "workbench",
    input: obj(
      {
        draftId: str("草稿标识", { minLength: 1 }),
        title: str("新标题；可空", { maxLength: 120 }),
        directoryId: str("目标目录（移动）；可空", { maxLength: 64 }),
        archived: bool("归档(true)/恢复(false)；可空"),
        consensusStatus: str(
          "共识状态：discussing / pending_confirm / agreed；可空",
          { maxLength: 32 }
        ),
        metadataRevision: int("并发覆盖保护；可空"),
        requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
      },
      ["draftId", "requestKey"]
    ),
    output: obj({
      value: obj(
        {
          id: str("草稿标识"),
          title: str("标题"),
          directoryId: str("目录"),
          consensusStatus: str("共识状态"),
          archived: bool("是否归档"),
          metadataRevision: int("修订号"),
          replayed: bool("是否为重放结果"),
        },
        [
          "id",
          "title",
          "directoryId",
          "archived",
          "metadataRevision",
          "replayed",
        ]
      ),
    }),
    effect:
      "写入：改名/移动/归档/恢复/共识状态；metadataRevision 过期明确冲突。",
  },
  v2_delete_draft: {
    title: "永久删除已归档草稿",
    owner: "workbench",
    input: obj({
      draftId: str("草稿标识", { minLength: 1 }),
      requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
    }),
    output: obj({
      value: obj({
        draftId: str("草稿标识"),
        deletedVersions: int("删除的版本数"),
        deletedThreads: int("删除的讨论线程数"),
        replayed: bool("是否为重放结果"),
      }),
    }),
    effect:
      "写入：仅本地用户可永久删除已归档草稿，级联清理其版本、产物与讨论。",
  },
  v2_list_drafts: {
    title: "查找工作台草稿",
    owner: "workbench",
    input: obj(
      {
        projectId: str("项目标识；可空", { maxLength: 64 }),
        kind: str("类型筛选；可空", { maxLength: 8 }),
        archived: bool("是否包含已归档"),
        cursor: str("分页游标（keyset）；可空", { maxLength: 256 }),
      },
      []
    ),
    output: obj({
      value: obj({
        items: listOf("草稿"),
        complete: bool("本页是否完整"),
        nextCursor: {
          type: ["string", "null"],
          description: "下一页 keyset 游标",
        },
      }),
    }),
    effect: "读取：草稿列表（keyset 分页）。",
  },
  v2_stage_package: {
    title: "导入内容包",
    owner: "workbench",
    input: obj({
      sourceDir: str("本机源目录绝对路径", { minLength: 1 }),
      kind: str("内容类型：markdown/board/ui", { maxLength: 8 }),
    }),
    output: obj({
      value: obj({
        artifactId: str("产物标识"),
        fileCount: int("文件数"),
        totalBytes: int("总字节数"),
      }),
    }),
    effect: "写入：复制源目录、生成冻结表示并封存为不可变产物（记录导入者）。",
  },
  v2_publish_version: {
    title: "发布版本",
    owner: "workbench",
    input: obj(
      {
        draftId: str("草稿标识", { minLength: 1 }),
        baseSequence: int("基础版本序号", { minimum: 0 }),
        artifactId: str("产物标识", { minLength: 1 }),
        requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
        summary: str("发布说明；可空", { maxLength: 2000 }),
      },
      ["draftId", "baseSequence", "artifactId", "requestKey"]
    ),
    output: obj({
      value: obj({
        versionId: str("版本标识"),
        sequence: int("版本序号"),
        replayed: bool("是否为重放结果"),
        draftId: str("草稿标识"),
        reviewRevision: int("审阅修订号"),
        projectId: str("项目标识"),
        title: str("草稿标题"),
        openUrl: str("可打开的固定版本入口（无长期凭据）"),
      }),
    }),
    effect: "写入：封存产物绑定新版本；重放返回原结果；base 过期明确冲突。",
  },
  v2_publish_inline: {
    title: "直接编辑并发布版本",
    owner: "workbench",
    input: obj(
      {
        draftId: str("草稿标识", { minLength: 1 }),
        baseSequence: int("基础版本序号", { minimum: 0 }),
        kind: str("内容类型：markdown/board", { maxLength: 8 }),
        markdown: str("markdown 正文；kind=markdown 时必填", {
          maxLength: 2000000,
        }),
        canvas: {
          type: "object",
          description: "board 画布 JSON；kind=board 时必填",
        },
        requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
        summary: str("发布说明；可空", { maxLength: 2000 }),
      },
      ["draftId", "baseSequence", "kind", "requestKey"]
    ),
    output: obj({
      value: obj({
        versionId: str("版本标识"),
        artifactId: str("封存产物标识"),
        sequence: int("版本序号"),
        replayed: bool("是否为重放结果"),
        draftId: str("草稿标识"),
        reviewRevision: int("审阅修订号"),
        projectId: str("项目标识"),
        title: str("草稿标题"),
        openUrl: str("可打开的固定版本入口（无长期凭据）"),
      }),
    }),
    effect:
      "写入：将工作台内编辑的文档/白板封装为不可变产物并发布新版本；base 过期明确冲突。",
  },
  v2_list_versions: {
    title: "列出草稿版本",
    owner: "workbench",
    input: obj(
      {
        draftId: str("草稿标识", { minLength: 1 }),
        cursor: int("分页游标；可空", { minimum: 0 }),
      },
      ["draftId"]
    ),
    output: obj({
      value: obj({
        items: listOf("版本"),
        complete: bool("本页是否完整"),
        nextCursor: {
          type: ["integer", "null"],
          description: "下一页游标",
        },
      }),
    }),
    effect: "读取：版本列表（分页）。",
  },
  v2_read_version: {
    title: "读取版本内容",
    owner: "workbench",
    input: obj(
      {
        draftId: str("草稿标识", { minLength: 1 }),
        versionId: str("版本标识；可空则最新", { maxLength: 64 }),
      },
      ["draftId"]
    ),
    output: obj({
      value: obj(
        {
          versionId: str("实际版本标识"),
          sequence: int("版本序号"),
          kind: str("内容类型"),
          rawMarkdown: str("markdown：原文"),
          blocks: {
            type: "array",
            items: { type: "object" },
            description: "markdown：冻结块投影",
          },
          canvas: {
            type: "object",
            description: "board：规范化画布（nodes/edges）",
          },
          manifest: {
            type: "object",
            description: "ui：路由清单（routes）",
          },
          files: { type: "array", items: str("包内文件路径") },
          reviewRevision: int("审阅修订号"),
        },
        ["versionId", "sequence", "kind", "files", "reviewRevision"]
      ),
    }),
    effect:
      "读取：按类型返回封存的冻结表示（markdown 块投影 / board 画布）与文件清单。",
  },
  v2_list_targets: {
    title: "列出定位目标",
    owner: "workbench",
    input: obj(
      {
        versionId: str("版本标识", { minLength: 1 }),
        cursor: int("分页游标；可空", { minimum: 0 }),
      },
      ["versionId"]
    ),
    output: obj({
      value: obj(
        {
          versionId: str("实际版本标识"),
          draftId: str("草稿标识"),
          kind: str("版本产物类型", { enum: ["markdown", "board", "ui"] }),
          items: listOf(
            "定位目标（markdown 块引用；board 对象；ui 路由+运行时元素清单）"
          ),
          complete: bool("本页是否完整"),
          nextCursor: {
            type: ["integer", "null"],
            description: "下一页游标",
          },
          elementsSupported: bool("ui：运行时元素清单能力（AC22）"),
          dynamicCaptured: int("ui：已采集页数"),
          note: str("采集说明"),
        },
        ["versionId", "draftId", "kind", "items", "complete", "nextCursor"]
      ),
    }),
    effect:
      "读取：markdown 冻结块分页；board 对象（含组归属/连线端点）；ui 路由+最近一次用户预览采集的运行时元素清单。",
  },
  v2_read_asset: {
    title: "读取版本资源",
    owner: "workbench",
    input: obj(
      {
        versionId: str("版本标识", { minLength: 1 }),
        path: str("包内资源路径", { minLength: 1, maxLength: 512 }),
        offset: int("分片偏移；可空", { minimum: 0 }),
      },
      ["versionId", "path"]
    ),
    output: obj({
      value: obj({
        path: str("资源路径"),
        totalBytes: int("总字节数"),
        offset: int("本片偏移"),
        data: str("本片内容（base64）"),
        nextOffset: {
          type: ["integer", "null"],
          description: "下一片偏移；null 为读取完整",
        },
        complete: bool("是否已读取完整"),
      }),
    }),
    effect: "读取：版本内资源分片（base64）；路径越界与符号链接逃逸明确拒绝。",
  },
  v2_compare_versions: {
    title: "比较两个版本",
    owner: "workbench",
    input: obj({
      draftId: str("草稿标识", { minLength: 1 }),
      leftVersionId: str("左版本标识", { minLength: 1 }),
      rightVersionId: str("右版本标识", { minLength: 1 }),
    }),
    output: obj({
      value: obj({
        left: obj({ versionId: str("版本"), sequence: int("序号") }),
        right: obj({ versionId: str("版本"), sequence: int("序号") }),
        kind: str("内容类型"),
        hunks: {
          type: "array",
          items: { type: "object" },
          description: "markdown：行级差异",
        },
        diff: { type: "object", description: "board：五类对象差异" },
        leftRaw: { type: "string", description: "markdown：左版原文" },
        rightRaw: { type: "string", description: "markdown：右版原文" },
      }),
    }),
    effect:
      "读取：markdown 行级差异与两侧原文；board 对象五类差异；两侧版本必须属于输入草稿。",
  },
  v2_create_thread: {
    title: "创建定位评论",
    owner: "workbench",
    input: obj(
      {
        versionId: str("版本标识", { minLength: 1 }),
        target: {
          type: "object",
          description:
            'markdown 定位：block+exact+可选 prefix/suffix；跨块传 segments 数组；整篇评论传 kind="document"',
          properties: {
            kind: str(
              "document 整篇；board 白板对象；ui 界面元素；可空为 markdown 块定位"
            ),
            objectId: str("board：对象标识；可空"),
            objectType: str(
              "board：node/edge/group；可空（服务端按版本画布重建）"
            ),
            attributes: {
              type: "object",
              description:
                "ui：桥采集的元素属性（键值均字符串，宿主按快照保留）；可空",
              properties: {},
              additionalProperties: { type: "string" },
            },
            page: str("ui：页面路由；可空"),
            tag: str("ui：元素标签；可空"),
            id: str("ui：元素 id；可空"),
            classes: str("ui：元素类名；可空"),
            text: str("ui：元素文本摘录；可空"),
            rect: { type: "object", description: "ui：元素矩形；可空" },
            viewport: { type: "object", description: "ui：视口；可空" },
            block: int("块索引"),
            exact: str("引文"),
            prefix: str("前文；可空"),
            suffix: str("后文；可空"),
            segments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  block: int("块索引"),
                  exact: str("引文"),
                  prefix: str("前文；可空"),
                  suffix: str("后文；可空"),
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        body: str("评论正文", { maxLength: 8000 }),
        requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
      },
      ["versionId", "target", "body", "requestKey"]
    ),
    output: obj({
      value: obj({
        threadId: str("线程标识"),
        replyId: str("回复标识"),
        replayed: bool("是否为重放结果"),
        anchor: { type: "object" },
      }),
    }),
    effect:
      "写入：线程固定创建时版本；服务端唯一解析锚点并持久化 resolved 快照。",
  },
  v2_add_reply: {
    title: "回复讨论",
    owner: "workbench",
    input: obj(
      {
        threadId: str("线程标识", { minLength: 1 }),
        body: str("回复正文", { maxLength: 8000 }),
        relatedVersionId: str("关联修改版本；可空", { maxLength: 64 }),
        requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
      },
      ["threadId", "body", "requestKey"]
    ),
    output: obj({
      value: obj({
        replyId: str("回复标识"),
        replayed: bool("是否为重放结果"),
      }),
    }),
    effect: "写入：回复可关联修改版本。",
  },
  v2_update_reply: {
    title: "编辑评论回复",
    owner: "workbench",
    input: obj({
      replyId: str("回复标识", { minLength: 1 }),
      body: str("新的回复正文", { maxLength: 8000 }),
      requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
    }),
    output: obj({
      value: obj({
        replyId: str("回复标识"),
        threadId: str("所属线程标识"),
        body: str("更新后的正文"),
        replayed: bool("是否为重放结果"),
      }),
    }),
    effect:
      "写入：更新指定回复正文；用户可编辑任意回复，Agent 仅可编辑自己发布的回复。",
  },
  v2_delete_reply: {
    title: "删除评论回复",
    owner: "workbench",
    input: obj({
      replyId: str("回复标识", { minLength: 1 }),
      requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
    }),
    output: obj({
      value: obj({
        replyId: str("回复标识"),
        threadId: str("所属线程标识"),
        threadDeleted: bool("是否因最后一条回复被删除而一并移除线程"),
        replayed: bool("是否为重放结果"),
      }),
    }),
    effect: "写入：删除指定回复；若为线程最后一条回复则一并删除线程。",
  },
  v2_delete_thread: {
    title: "删除讨论线程",
    owner: "workbench",
    input: obj({
      threadId: str("线程标识", { minLength: 1 }),
      requestKey: str("请求键（幂等）", { minLength: 1, maxLength: 128 }),
    }),
    output: obj({
      value: obj({
        threadId: str("线程标识"),
        draftId: str("所属草稿标识"),
        deletedReplies: int("删除的回复数"),
        replayed: bool("是否为重放结果"),
      }),
    }),
    effect: "写入：删除讨论线程及其全部回复与状态事件。",
  },
  v2_set_thread_status: {
    title: "设置讨论状态",
    owner: "workbench",
    input: obj({
      threadId: str("线程标识", { minLength: 1 }),
      status: str("open 或 resolved", { maxLength: 8 }),
      requestKey: str("请求键（幂等；重复请求返回原事件）", {
        minLength: 1,
        maxLength: 128,
      }),
    }),
    output: obj({
      value: obj({
        threadId: str("线程标识"),
        status: str("状态"),
        changed: bool("是否发生变化"),
        replayed: bool("是否为重放结果"),
      }),
    }),
    effect:
      "写入：用户可解决任何线程；Agent 仅自己发起的线程；状态变化记录操作者与请求身份。",
  },
  v2_list_threads: {
    title: "列出讨论线程",
    owner: "workbench",
    input: obj(
      {
        draftId: str("草稿标识", { minLength: 1 }),
        versionId: str("按版本筛选；可空", { maxLength: 64 }),
        status: str("按状态筛选；可空", { maxLength: 8 }),
        authorActor: str("按线程或回复参与作者筛选；可空", {
          minLength: 1,
          maxLength: 128,
        }),
        cursor: str("分页游标（keyset）；可空", { maxLength: 256 }),
      },
      ["draftId"]
    ),
    output: obj({
      value: obj({
        items: listOf("线程（含持久化锚点）"),
        authorActors: {
          type: "array",
          items: { type: "string" },
          description: "该草稿全部讨论参与者，不受当前分页/筛选限制",
        },
        complete: bool("本页是否完整"),
        nextCursor: {
          type: ["string", "null"],
          description: "下一页 keyset 游标",
        },
        reviewRevision: int("审阅修订号"),
      }),
    }),
    effect:
      "读取：线程固定版本归属并携带锚点快照（keyset 分页）；实时列表语义。",
  },
  v2_read_thread: {
    title: "读取讨论线程与回复",
    owner: "workbench",
    input: obj(
      {
        threadId: str("线程标识", { minLength: 1 }),
        replyCursor: str("回复分页游标（keyset）；可空", {
          maxLength: 256,
        }),
      },
      ["threadId"]
    ),
    output: obj({
      value: obj({
        thread: { type: "object" },
        replies: obj({
          items: listOf("回复"),
          complete: bool("本页是否完整"),
          nextCursor: {
            type: ["string", "null"],
            description: "下一页 keyset 游标",
          },
        }),
      }),
    }),
    effect: "读取：线程详情与 keyset 分页回复。",
  },
  v2_open_version: {
    title: "打开固定版本入口",
    owner: "workbench",
    input: obj(
      {
        draftId: str("草稿标识", { minLength: 1 }),
        versionId: str("版本标识", { minLength: 1 }),
        compareVersionId: str("比较版本标识；可空", { maxLength: 64 }),
      },
      ["draftId", "versionId"]
    ),
    output: obj({
      value: obj({
        draftId: str("草稿标识"),
        versionId: str("实际版本标识"),
        compareVersionId: {
          type: ["string", "null"],
          description: "比较版本",
        },
        openUrl: str("可打开的固定版本入口（无长期凭据）"),
      }),
    }),
    effect: "读取：签发固定版本深链；版本必须属于输入草稿。",
  },
}

export const noteTools = toolOperations.map((pair) => {
  const [operation, name] = pair.split(":")
  const { title, input } = noteOperations[operation]
  return {
    operation,
    spec: {
      name,
      shareable: true,
      description: title,
      inputSchema: input,
      annotations: readOnlyTools.has(name) ? { readOnlyHint: true } : undefined,
    },
  }
})
