import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { HomeComposer } from "./home-composer"
import { homeData, submitMockWork } from "../../../ui-catalog/fixtures/home"
import { useCallback, useRef, useState } from "react"
import {
  SessionServiceContext,
  type SessionService,
} from "@/features/session/session-service"
import type {
  HomeDraftStore,
  HomeSubmission,
} from "@/features/conversation/conversation-draft-store"
import type { HomeDraft, HomeSubmitReceipt } from "./home-types"
import { ConversationComposer } from "@/features/conversation/composer/conversation-composer"
import { hasPreparingHomeMaterials } from "./home-submission-lifecycle"
import { recoverRejectedHomeDraft } from "./home-submission-draft"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { Button } from "@/components/ui/button"
import {
  MaterialServiceContext,
  type MaterialService,
} from "@/features/materials/material-service"
import {
  exampleMaterialService,
  exampleMaterials,
} from "@/features/materials/material-catalog-fixtures"

function wait(signal?: AbortSignal, duration = 80) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted()
    const finish = () => {
      signal?.removeEventListener("abort", abort)
      resolve()
    }
    const timer = setTimeout(finish, duration)
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException("已取消", "AbortError"))
    }
    signal?.addEventListener("abort", abort, { once: true })
  })
}
function ConfigExample({
  mode,
}: {
  mode: "catalog-error" | "read-error" | "loading" | "restart"
}) {
  const [service] = useState<SessionService>(() => {
    let attempts = 0
    return {
      catalog: async (cwd, signal) => {
        await wait(signal, mode === "loading" ? 5000 : 80)
        if (mode === "restart")
          throw Object.assign(new Error("宿主版本不匹配"), {
            issue: {
              code: "host_version",
              summary: "会话服务版本已更新，需要重新启动 Moon。",
              recovery: "restart",
              severity: "warning",
            },
          })
        if (mode === "catalog-error" && attempts++ === 0)
          throw new Error("工作目录中的会话配置暂时无法读取，草稿已保留。")
        return {
          cwd,
          tools: homeData.tools.map((tool) => ({
            ...tool,
            available: true,
            unavailableReason: "",
          })),
          instructions: [],
          defaults: { toolIds: ["read"], instructionScope: "all" as const },
        }
      },
      read: async (_id, signal) => {
        await wait(signal)
        if (mode === "read-error" && attempts++ === 0)
          throw new Error("已保存的会话配置暂时无法读取，草稿已保留。")
        return null
      },
      apply: async (input) => ({
        ...input,
        revision: (input.revision ?? 0) + 1,
        effectiveToolIds: input.toolIds,
        unavailableToolIds: [],
        instructions: [],
      }),
    }
  })
  return (
    <SessionServiceContext.Provider value={service}>
      <HomeComposer
        data={homeData}
        initialDraft={{
          sessionId: "catalog-home-config",
          text: "读取配置失败后继续编辑这份需求",
        }}
        onSubmit={submitMockWork}
      />
    </SessionServiceContext.Provider>
  )
}
function SaveExample() {
  const [store] = useState<HomeDraftStore>(() => {
    let attempts = 0
    return {
      read: () => ({}),
      write: () => {
        if (attempts++ === 0) throw new Error("展示存储写入失败")
      },
    }
  })
  return (
    <HomeComposer
      data={homeData}
      draftStore={store}
      initialDraft={{ text: "编辑一次触发保存失败，当前内容继续保留" }}
      onSubmit={submitMockWork}
    />
  )
}
function SubmissionBoundaryExample({
  mode = "accept",
}: {
  mode?: "accept" | "reject" | "unknown"
}) {
  const [received, setReceived] = useState("")
  const [record, setRecord] = useState<HomeSubmission>()
  const [key, setKey] = useState(0)
  const [waiting, setWaiting] = useState(false)
  const [checking, setChecking] = useState(false)
  const request = useRef<{
    resolve: (value: string) => void
    reject: (error: Error) => void
    cleanup: () => void
  } | null>(null)
  const check = useRef<(() => void) | null>(null)
  const [store] = useState<HomeDraftStore>(() => {
    const values = new Map<string, HomeDraft>()
    return {
      read: (workspaceId) => structuredClone(values.get(workspaceId) ?? {}),
      write: (draft) => {
        values.set(draft.workspaceId, structuredClone(draft))
      },
    }
  })
  const [service] = useState(() => ({
    ...exampleMaterialService,
    choose: async () => [exampleMaterials[0]!],
  }))
  return (
    <MaterialServiceContext.Provider value={service}>
      <HomeComposer
        key={key}
        data={homeData}
        draftStore={store}
        pendingSubmission={record}
        initialDraft={
          record
            ? {
                workspaceId: record.draft.workspaceId,
                sessionId: record.sessionId,
              }
            : { text: "第一次提交的固定需求" }
        }
        onSubmissionPrepare={(copy, following) => {
          store.write(following)
          setRecord(copy)
        }}
        onSubmit={(submitted, signal) => {
          setReceived(submitted.text)
          setWaiting(true)
          return new Promise<string>((resolve, reject) => {
            const abort = () => {
              request.current = null
              setWaiting(false)
              reject(new DOMException("已取消", "AbortError"))
            }
            signal?.addEventListener("abort", abort, { once: true })
            request.current = {
              resolve,
              reject,
              cleanup: () => signal?.removeEventListener("abort", abort),
            }
          })
        }}
        onCheckSubmission={(_id, signal) => {
          signal?.throwIfAborted()
          setChecking(true)
          return new Promise<void>((resolve, reject) => {
            const cancel = () => {
              check.current = null
              setChecking(false)
              reject(new DOMException("已取消核对", "AbortError"))
            }
            signal?.addEventListener("abort", cancel, { once: true })
            check.current = () => {
              signal?.removeEventListener("abort", cancel)
              resolve()
            }
          })
        }}
      />
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button
          variant="outline"
          disabled={!waiting}
          onClick={() => {
            const active = request.current
            if (!active) return
            active.cleanup()
            request.current = null
            setWaiting(false)
            if (mode === "accept") {
              setRecord(undefined)
              active.resolve("原提交已接受，下一条草稿保留")
            } else if (mode === "reject") {
              setRecord(undefined)
              active.reject(new Error("原消息未被接收，请修正模型连接后重试。"))
            } else
              active.reject(
                Object.assign(new Error("未确认原消息结果"), {
                  issue: {
                    code: "result_unknown",
                    summary: "尚未确认原消息是否已接收，请核对原请求。",
                    recovery: "check",
                    severity: "warning",
                  },
                })
              )
          }}
        >
          {mode === "accept"
            ? "返回接受回执"
            : mode === "reject"
              ? "返回明确拒绝"
              : "返回未知回执"}
        </Button>
        {mode === "unknown" && (
          <>
            <Button
              variant="outline"
              disabled={!record || waiting || checking}
              onClick={() => setKey((value) => value + 1)}
            >
              重新挂载首页
            </Button>
            <Button
              variant="outline"
              disabled={!checking}
              onClick={() => {
                setRecord(undefined)
                setChecking(false)
                const complete = check.current
                check.current = null
                complete?.()
              }}
            >
              确认原请求已接收
            </Button>
          </>
        )}
      </div>
      {received && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          隔离展示收到的原副本：{received}
        </p>
      )}
    </MaterialServiceContext.Provider>
  )
}
function MaterialCancellationExample({
  restore = false,
}: {
  restore?: boolean
}) {
  const [service] = useState(() => {
    let attempts = 0
    return {
      ...exampleMaterialService,
      choose: async () => {
        throw new DOMException("已取消选择", "AbortError")
      },
      restore: async (
        ...args: Parameters<typeof exampleMaterialService.restore>
      ) => {
        await wait(args[3])
        if (restore && attempts++ === 0)
          throw new DOMException("已取消核对", "AbortError")
        return exampleMaterialService.restore(...args)
      },
    }
  })
  return (
    <MaterialServiceContext.Provider value={service}>
      <HomeComposer
        data={homeData}
        initialDraft={{
          sessionId: "catalog-home-material",
          text: "取消选择或核对时保留原草稿",
          materials: restore ? [exampleMaterials[0]!] : [],
        }}
        onSubmit={submitMockWork}
      />
    </MaterialServiceContext.Provider>
  )
}
function AcceptedSelectionExample({ failed = false }: { failed?: boolean }) {
  const [record, setRecord] = useState<HomeSubmission>()
  const [accepted, setAccepted] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [inactive, setInactive] = useState(false)
  const [completed, setCompleted] = useState<HomeDraft>()
  const acceptedRef = useRef(false)
  const selectingRef = useRef(false)
  const editing = useRef<HomeDraft | undefined>(undefined)
  const receipt = useRef<((value: HomeSubmitReceipt) => void) | null>(null)
  const selection = useRef<{
    resolve: (items: Awaited<ReturnType<MaterialService["choose"]>>) => void
    cleanup: () => void
  } | null>(null)
  const finish = useCallback(() => {
    if (
      !acceptedRef.current ||
      selectingRef.current ||
      !editing.current ||
      hasPreparingHomeMaterials(editing.current)
    )
      return
    setCompleted(structuredClone(editing.current))
  }, [])
  const onDraftChange = useCallback(
    (draft: HomeDraft) => {
      editing.current = draft
      finish()
    },
    [finish]
  )
  const onSelectionActivity = useCallback(
    (_id: string, active: boolean) => {
      selectingRef.current = active
      setSelecting(active)
      finish()
    },
    [finish]
  )
  const [service] = useState(() => {
    let failedRestoreShown = false
    return {
      ...exampleMaterialService,
      restore: async (
        id: string,
        cwd: string,
        references: Parameters<MaterialService["restore"]>[2],
        signal?: AbortSignal
      ) => {
        await new Promise<void>((resolve) => queueMicrotask(resolve))
        signal?.throwIfAborted()
        if (
          failed &&
          !failedRestoreShown &&
          references.some((item) => item.status === "failed")
        ) {
          failedRestoreShown = true
          return references.map((item) => ({
            ...item,
            type: item.type ?? "file",
            source: item.source ?? "",
            status: "failed" as const,
          }))
        }
        return exampleMaterialService.restore(id, cwd, references, signal)
      },
      choose: (_id: string, _cwd: string, signal?: AbortSignal) =>
        new Promise<Awaited<ReturnType<MaterialService["choose"]>>>(
          (resolve, reject) => {
            const cancel = () =>
              reject(new DOMException("已取消", "AbortError"))
            signal?.addEventListener("abort", cancel, { once: true })
            selection.current = {
              resolve,
              cleanup: () => signal?.removeEventListener("abort", cancel),
            }
          }
        ),
    }
  })
  const [store] = useState<HomeDraftStore>(() => {
    const drafts = new Map<string, HomeDraft>()
    return {
      read: (id) => structuredClone(drafts.get(id) ?? {}),
      write: (draft) => {
        drafts.set(draft.workspaceId, structuredClone(draft))
      },
    }
  })
  return (
    <MaterialServiceContext.Provider value={service}>
      {completed ? (
        <ConversationComposer
          data={homeData}
          draft={completed}
          sessionId={completed.sessionId}
          workspacePath={homeData.workspaces[0]!.path}
          onChange={setCompleted}
          onSubmit={() => {}}
          onStop={() => {}}
        />
      ) : (
        <>
          <div hidden={inactive} className={inactive ? "hidden" : undefined}>
            <HomeComposer
              data={homeData}
              draftStore={store}
              inactive={inactive}
              initialDraft={{ text: "先发送这份原需求，然后为下一条选择附件" }}
              pendingSubmission={record}
              acceptedSubmissionIds={
                accepted && record ? [record.sessionId] : []
              }
              onDraftChange={onDraftChange}
              onMaterialSelectionActivity={onSelectionActivity}
              onSubmissionPrepare={(copy, following) => {
                store.write(following)
                setRecord(copy)
              }}
              onSubmit={() =>
                new Promise<HomeSubmitReceipt>((resolve) => {
                  receipt.current = resolve
                })
              }
            />
          </div>
          {inactive && (
            <div className="rounded-lg border p-5">
              <label className="block text-sm">
                另一页面的输入
                <input
                  className="mt-2 block w-full rounded-md border px-3 py-2"
                  placeholder="在这里编辑，原窗口不能抢焦点"
                />
              </label>
            </div>
          )}
        </>
      )}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          disabled={!record || accepted || !!completed}
          onClick={() => {
            acceptedRef.current = true
            setAccepted(true)
            receipt.current?.({ disposition: "conversation" })
            finish()
          }}
        >
          原请求已接受
        </Button>
        <Button
          variant="outline"
          disabled={!selecting || !!completed}
          onClick={() => {
            const current = selection.current
            if (!current) return
            current.cleanup()
            selection.current = null
            current.resolve([
              {
                ...exampleMaterials[0]!,
                ...(failed
                  ? {
                      status: "failed" as const,
                      retryable: true,
                      error: "附件暂时未能准备，保留失败条目。",
                    }
                  : {}),
              },
            ])
          }}
        >
          {failed ? "附件准备失败" : "附件准备完成"}
        </Button>
        <Button
          variant="outline"
          disabled={!selecting || !!completed}
          onClick={() => setInactive((value) => !value)}
        >
          {inactive ? "返回原输入" : "查看另一页面"}
        </Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        先发送，再点“添加附件”。选择未回执时让原请求接受：原 owner
        等待附件结果；可切另一页面检查焦点，结果返回后展示正式对话输入。受控回执与材料均为隔离展示。
      </p>
    </MaterialServiceContext.Provider>
  )
}

/** Controlled external recovery uses the production component and material owner. */
function RejectedRecoveryExample() {
  const originalText = "保留这份原始需求，检查首页交互"
  const [record, setRecord] = useState<HomeSubmission>()
  const [restored, setRestored] = useState<{
    submission: HomeSubmission
    feedback: FeedbackDescription
  }>()
  const [phase, setPhase] = useState<
    "initial" | "waiting" | "recovery" | "restored" | "done"
  >("initial")
  const [inactive, setInactive] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [snapshot, setSnapshot] = useState<HomeDraft>()
  const editing = useRef<HomeDraft | undefined>(undefined)
  const submissionCopy = useRef<HomeSubmission | undefined>(undefined)
  const refuse = useRef<{
    reject: (error: Error) => void
    cleanup: () => void
  } | null>(null)
  const preparation = useRef<{
    resolve: (items: Awaited<ReturnType<MaterialService["prepare"]>>) => void
    cleanup: () => void
  } | null>(null)
  const failRecoveryWrite = useRef(false)
  const [store] = useState<HomeDraftStore>(() => {
    const drafts = new Map<string, HomeDraft>()
    return {
      read: (id) => structuredClone(drafts.get(id) ?? {}),
      write: (draft) => {
        if (failRecoveryWrite.current) throw new Error("受控本地恢复写入失败")
        drafts.set(draft.workspaceId, structuredClone(draft))
      },
    }
  })
  const [service] = useState<MaterialService>(() => ({
    ...exampleMaterialService,
    prepare: (_id, _cwd, _paths, signal) =>
      new Promise((resolve, reject) => {
        signal?.throwIfAborted()
        const cancel = () => {
          preparation.current = null
          setPreparing(false)
          reject(new DOMException("已取消", "AbortError"))
        }
        signal?.addEventListener("abort", cancel, { once: true })
        preparation.current = {
          resolve,
          cleanup: () => signal?.removeEventListener("abort", cancel),
        }
        setPreparing(true)
      }),
  }))
  const onDraftChange = useCallback((draft: HomeDraft) => {
    editing.current = draft
    setSnapshot(draft)
  }, [])
  function restore() {
    const submission = submissionCopy.current
    const current = editing.current
    if (!submission || !current) return
    failRecoveryWrite.current = false
    const recovery = recoverRejectedHomeDraft(submission, current)
    store.write(recovery.draft)
    setRecord(undefined)
    setPhase("restored")
    // Changing the signal object a second time must not merge the same copy twice.
    setRestored({
      submission,
      feedback: {
        code: "send_rejected",
        message: "原消息未被接受，原需求和等待期间的新文字、材料已恢复。",
        recovery: "none",
        severity: "warning",
      },
    })
  }
  const occurrences = (snapshot?.text ?? "").split(originalText).length - 1
  return (
    <MaterialServiceContext.Provider value={service}>
      <div hidden={inactive} className={inactive ? "hidden" : undefined}>
        <HomeComposer
          data={homeData}
          draftStore={store}
          inactive={inactive}
          initialDraft={{ text: originalText }}
          pendingSubmission={record}
          restoredSubmission={restored}
          recoverySubmissionIds={
            phase === "recovery" && record ? [record.sessionId] : []
          }
          onDraftChange={onDraftChange}
          onSubmissionPrepare={(copy, following) => {
            store.write(following)
            if (phase === "initial") {
              submissionCopy.current = copy
              setRecord(copy)
            }
          }}
          onSubmit={(_draft, signal) => {
            if (phase !== "initial") {
              setPhase("done")
              return "恢复后可以正常发送；此处只展示前端回执边界。"
            }
            setPhase("waiting")
            return new Promise<HomeSubmitReceipt>((_resolve, reject) => {
              const cancel = () =>
                reject(new DOMException("已取消", "AbortError"))
              signal?.addEventListener("abort", cancel, { once: true })
              refuse.current = {
                reject,
                cleanup: () => signal?.removeEventListener("abort", cancel),
              }
            })
          }}
        />
      </div>
      {inactive && (
        <div className="rounded-lg border p-5">
          <label className="block text-sm">
            另一页面的输入
            <input
              className="mt-2 block w-full rounded-md border px-3 py-2"
              placeholder="材料完成与外部恢复不能抢走这里的焦点"
            />
          </label>
        </div>
      )}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          disabled={phase !== "waiting" || !preparing}
          onClick={() => {
            const request = refuse.current
            if (!request || !record) return
            request.cleanup()
            refuse.current = null
            failRecoveryWrite.current = true
            setRecord({ ...record, stage: "rejected" })
            setPhase("recovery")
            request.reject(
              Object.assign(new Error("原消息明确拒绝，但本地恢复写入失败。"), {
                issue: {
                  code: "home_recovery_pending",
                  summary: "原消息未被接受，原副本与新输入保留，请恢复草稿。",
                  recovery: "retry",
                  severity: "warning",
                },
              })
            )
          }}
        >
          拒绝并使本地恢复失败
        </Button>
        <Button
          variant="outline"
          disabled={phase !== "recovery" && phase !== "restored"}
          onClick={restore}
        >
          {phase === "restored"
            ? "再次发出同一恢复信号"
            : "从页面外部恢复原草稿"}
        </Button>
        <Button
          variant="outline"
          disabled={!preparing || phase !== "restored"}
          onClick={() => {
            const current = preparation.current
            if (!current) return
            current.cleanup()
            preparation.current = null
            setPreparing(false)
            current.resolve([exampleMaterials[0]!])
          }}
        >
          完成已有材料准备
        </Button>
        <Button
          variant="outline"
          disabled={phase === "initial" || phase === "done"}
          onClick={() => setInactive((value) => !value)}
        >
          {inactive ? "返回原输入" : "查看另一页面"}
        </Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        先发送，在空输入写下一条；通过＋ → 引用文件 → 首页验收说明.md
        发起材料准备。依次拒绝、外部恢复、完成材料；重复恢复信号应保持原文一次。隐藏页面时仍是同一材料
        owner。此状态使用隔离回执和存储，不调用模型或用户文件。
      </p>
      <output className="mt-2 block text-center text-xs text-muted-foreground">
        原需求出现 {occurrences} 次 · 材料 {snapshot?.materials.length ?? 0} 项
        · {preparing ? "已有材料准备中" : "材料操作已结束"}
        {phase === "done" ? " · 已正常再次发送" : ""}
      </output>
    </MaterialServiceContext.Provider>
  )
}
export default {
  id: "home-composer",
  name: "工作输入区",
  layer: "复合组件",
  group: "首页",
  source: "src/features/home/home-composer.tsx",
  description: "选择工作上下文、编辑需求和材料，通过提交回调获得结果反馈。",
  boundary:
    "负责首页输入；正式App拥有持久草稿和提交，SessionServiceContext提供配置，MaterialServiceContext准备实际材料。目录使用隔离数据与替身，不调用模型或用户文件。",
  inputs: [
    "inactive: 保留已开始材料操作的原 owner，关闭 portal/监听/新入口，不取消既有 prepare；onMaterialSelectionActivity 报告未返回的原生 choose，不写入草稿。",
    "data: workspaces/models/materials/tools 可选资源。",
    "initialDraft?: Partial<HomeDraft>，初始需求、材料、模型和工具配置。",
    "onSubmissionPrepare先持久不可变HomeSubmission与nextDraft；onSubmit接收canonical副本、AbortSignal及原始草稿；兼容string成功与conversation交接receipt。",
    "onDraftChange保存当前窗口草稿；onChooseWorkspace/onWorkspaceSelect由正式App接入系统目录选择和工作区服务。",
    "recoverySubmissionIds: 已知未接受且需本地恢复的身份；恢复不会核对不存在的模型会话。",
    "restoredSubmission: 页面级恢复通知原 owner，同一提交只合并一次，已有材料操作继续完成，不以 initialDraft 变更或重挂载替代。",
    "acceptedSubmissionIds: 已接受但尚未清理的原身份；禁重复发送，只提供状态说明，清理反馈归正式App。",
    "pendingSubmission恢复durable原副本；submissionIssue保留正式App拒绝恢复后的反馈。等待允许编辑下一条；接受后App先持久交接到同一对话，再清除Home源。",
  ],
  events: [
    "提交需有效文字或就绪材料、有效目录和兼容模型；Enter发送、Shift+Enter换行，候选选择和输入法选字不提交。",
    "材料添加去重，可逐项移除；编辑可以清除已明确拒绝的发送反馈，不清除仍阻止发送的配置读取错误。",
    "提交后正文腾空，UserMessage显示有界原副本；待核对禁新发送，首次三次只读自动核对原requestId，持久未知手动检查，不自动重发。明确拒绝自动恢复原稿，已有次稿则合并文字与去重材料并说明。",
  ],
  composition: [
    "WorkspacePicker、PromptInput、SelectedMaterials、ComposerToolbar",
    "ComposerToolbar 负责材料、模型、思考、配置与发送",
    "FieldGroup/Field、InputGroup、OperationFeedback、HomeSubmissionNotice",
    "HomeSubmissionEcho → 正式UserMessage；原副本与nextDraft职责分离",
  ],
  consumers: ["App（正式首页）", "HomePage（独立展示）"],
  viewport: { width: 800, height: 600 },
  states: [
    {
      id: "rejected-recovery-preparing",
      name: "拒绝恢复失败与外部恢复",
      condition:
        "原消息明确拒绝，本地恢复先失败，下一稿材料仍在准备；随后从页面外部发出 restoredSubmission。",
      expected:
        "始终保持同一材料 owner；隐藏不抢焦点，恢复仅合并一次，材料结束后原稿与次稿均保留并可正常再次发送。",
      render: () => <RejectedRecoveryExample />,
    },
    {
      id: "accepted-selection-delayed",
      name: "接受后等待附件选择",
      condition: "原消息等待时发起下一稿附件选择；原消息先接受。",
      expected:
        "保持同一 Home owner，禁新入口；隐藏后不抢焦点，附件成功后原下一稿进入正式对话输入。",
      render: () => <AcceptedSelectionExample />,
    },
    {
      id: "accepted-selection-failed",
      name: "接受后保留附件失败",
      condition: "原消息已接受，下一稿附件最后准备失败。",
      expected: "失败附件保留错误和移除入口，不强丢或冻结 preparing 快照。",
      render: () => <AcceptedSelectionExample failed />,
    },
    {
      id: "config-restart",
      name: "宿主需重启",
      condition: "会话配置读取返回host_version/restart/warning。",
      expected:
        "保留草稿、警告层级和重启指引，不显示无法解决版本问题的重读按钮。",
      render: () => <ConfigExample mode="restart" />,
    },
    {
      id: "submission-delay",
      name: "首次回执等待与新草稿",
      condition:
        "正式组件等待外部“返回接受回执”；仅隔离前端回执边界，不调用模型。",
      expected:
        "原copy同形回显、正文和材料腾空；可写下一条、加材料；不能重复发送，接受后次稿保留且不再使用已接受Home身份。",
      render: () => <SubmissionBoundaryExample />,
    },
    {
      id: "submission-rejected-followup",
      name: "拒绝与等待期间的新稿",
      condition: "发送后编辑下一条、添加材料，再外部返回明确拒绝。",
      expected:
        "撤除提交回声；原稿立即与次稿自动合并，材料去重，两份内容都保留并说明，无放回输入框的第二步。",
      render: () => <SubmissionBoundaryExample mode="reject" />,
    },
    {
      id: "many-materials",
      name: "12项材料与窄窗",
      condition: "十二份带长名称的文件，使用正式输入卡与材料轨。",
      expected:
        "材料水平局部滚动，正文与发送不随数量向下移动；＋候选保持视口内。",
      render: () => (
        <HomeComposer
          data={homeData}
          initialDraft={{
            text: "核对这些文件，并保留当前需求。",
            materials: Array.from({ length: 12 }, (_, index) => ({
              id: `catalog-many-${index}`,
              name: `${index + 1}-首页交互验收说明与目录草稿.md`,
              kind: "附件",
              type: "file",
              status: "ready",
              source: `docs/${index + 1}-首页交互验收说明.md`,
            })),
          }}
          onSubmit={submitMockWork}
        />
      ),
    },
    {
      id: "config-catalog-error",
      name: "配置目录读取失败",
      condition: "首次会话配置目录读取失败。",
      expected:
        "独立原位反馈与重新读取配置；继续编辑不能清掉错误，重读成功才可发送。",
      render: () => <ConfigExample mode="catalog-error" />,
    },
    {
      id: "config-read-error",
      name: "已存配置读取失败",
      condition: "首次读取已有配置失败。",
      expected: "保留草稿并禁发，重读只恢复配置，不自动发送或清空草稿。",
      render: () => <ConfigExample mode="read-error" />,
    },
    {
      id: "config-loading",
      name: "配置读取中仍可编辑",
      condition: "配置服务返回延迟5秒。",
      expected: "读取中有明确说明，可继续编辑；读取完成前不会提交。",
      render: () => <ConfigExample mode="loading" />,
    },
    {
      id: "save-error",
      name: "草稿持久化失败",
      condition: "首次编辑时持久保存失败。",
      expected: "保存错误只有一处，保留当前输入；重试保存成功后恢复发送。",
      render: () => <SaveExample />,
    },
    {
      id: "send-unknown",
      name: "发送未知只核对原请求",
      condition:
        "外部返回未知回执；编辑次稿后重新挂载，再核对原请求并返回已接受。",
      expected:
        "警告与核对动作只有一处，允许编辑但禁用新发送；只核对，明确接受后才清理对应草稿。",
      render: () => <SubmissionBoundaryExample mode="unknown" />,
    },
    {
      id: "unsupported-compact",
      name: "首页不能压缩未开始对话",
      condition: "首页手写 /compact 调用。",
      expected:
        "就地说明先打开会话，保留文字；按钮与Enter均不把压缩命令发给模型。",
      render: () => (
        <HomeComposer
          data={homeData}
          initialDraft={{ text: "/compact 保留工作重点" }}
          onSubmit={submitMockWork}
        />
      ),
    },
    {
      id: "attachment-cancelled",
      name: "取消附件选择",
      condition: "从＋添加附件时选择返回取消。",
      expected: "不展示红色错误，不新增材料，原草稿不变。",
      render: () => <MaterialCancellationExample />,
    },
    {
      id: "material-restore-cancelled",
      name: "材料核对取消与恢复",
      condition: "已有材料首次核对被取消。",
      expected:
        "原材料保留，不标记失败；显示中性取消说明与重新检查，核对完成后恢复发送。",
      render: () => <MaterialCancellationExample restore />,
    },
    {
      id: "unconfirmed",
      name: "原请求待核对",
      condition: "原首页会话存在未清理提交身份。",
      expected: "新发送禁用，草稿可编辑；核对按钮不发送改写后的草稿。",
      render: () => (
        <HomeComposer
          data={homeData}
          initialDraft={{
            sessionId: "catalog-pending",
            text: "保留尚未确认的需求",
          }}
          unconfirmedSessionIds={["catalog-pending"]}
          onCheckSubmission={async () => {
            throw new Error("示例回执仍待确认，原草稿保留。")
          }}
          onSubmit={submitMockWork}
        />
      ),
    },
    {
      id: "empty",
      name: "空草稿",
      condition: "提供完整选项，需求为空。",
      expected: "发送禁用；可输入、选择目录或添加材料。",
      render: () => <HomeComposer data={homeData} onSubmit={submitMockWork} />,
    },
    {
      id: "materials",
      name: "带材料草稿",
      condition: "初始文本和附件/Skill 已选择。",
      expected: "显示材料名称；可移除、切换模型并发送，结果反映当前选择。",
      render: () => (
        <HomeComposer
          data={homeData}
          initialDraft={{
            text: "请检查首页交互与可访问性",
            materials: [homeData.materials[0]!, homeData.materials[2]!],
          }}
          onSubmit={submitMockWork}
        />
      ),
    },
    {
      id: "send-rejected",
      name: "发送未接受",
      condition: "提交函数在消息被接受前失败。",
      expected: "反馈靠近输入，原文字、模型与工作区保留，可修正后重新发送。",
      render: () => (
        <HomeComposer
          data={homeData}
          initialDraft={{
            text: "读取 README.md，确认两个入口使用同一个后端。",
          }}
          onSubmit={() => {
            throw new Error("模型不可用，消息尚未发送。请检查连接后重新发送。")
          }}
        />
      ),
    },
    {
      id: "unavailable",
      name: "资源不可用",
      condition: "目录、模型与材料均为空。",
      expected: "显示无可用目录/模型，输入内容也不能提交，无崩溃。",
      render: () => (
        <HomeComposer
          data={{ workspaces: [], models: [], materials: [], tools: [] }}
          initialDraft={{ text: "检查无资源状态" }}
          onSubmit={submitMockWork}
        />
      ),
    },
  ],
} satisfies CatalogEntry
