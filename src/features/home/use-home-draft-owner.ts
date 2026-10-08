import { useComposerAnchor } from "@/lib/composer/use-composer-anchor"
import { type ComposerEditorElement } from "@/components/composer/composer-editor-contract"
import {
  homeSessionId,
  SessionServiceContext,
} from "@/features/session/session-service"
import { effectiveThinking } from "@/lib/composer/model-thinking"
import "./home.css"
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { ComposerDraft } from "@/lib/composer/types"

import {
  bindHomeDraftIdentity,
  matchesHomeSubmission,
} from "@/features/conversation/conversation-draft-store"

import { editableComposerDraft } from "@/components/composer/composer-policy"

import {
  followingHomeDraft,
  homeDraftRecoveryKey,
} from "./home-submission-draft"

import type { HomeComposerProps } from "./home-composer.types"

/** 只维护这一组状态的所有权，迟到结果仍按原身份核对。 */
export function useHomeDraftOwner({
  data,
  inactive = false,
  initialDraft = {},
  draftStore,
  pendingSubmission,
  restoredSubmission,
  onRestorationPersisted,
  onDraftChange,
}: Pick<
  HomeComposerProps,
  | "data"
  | "inactive"
  | "initialDraft"
  | "draftStore"
  | "pendingSubmission"
  | "restoredSubmission"
  | "onRestorationPersisted"
  | "onDraftChange"
>) {
  const sessionService = useContext(SessionServiceContext)
  const { models, materials, tools } = data
  const [addedWorkspaces, setWorkspaces] = useState<typeof data.workspaces>([])
  const workspaces = useMemo(
    () => [
      ...data.workspaces,
      ...addedWorkspaces.filter(
        (item) => !data.workspaces.some((workspace) => workspace.id === item.id)
      ),
    ],
    [data.workspaces, addedWorkspaces]
  )
  const bindDraftIdentity = useCallback(
    (candidate: ComposerDraft) =>
      bindHomeDraftIdentity(candidate, () => {
        // Legacy nonempty drafts have no evidence tying them to the old cwd map.
        // Give them a fresh identity; a receipt for an earlier input cannot erase them.
        if (candidate.text.trim() || candidate.materials.length)
          return crypto.randomUUID()
        const cwd = workspaces.find(
          (item) => item.id === candidate.workspaceId
        )?.path
        return sessionService && cwd ? homeSessionId(cwd) : crypto.randomUUID()
      }),
    [sessionService, workspaces]
  )
  const { anchorRef, anchorNode, bindAnchor } = useComposerAnchor()
  const inputRef = useRef<ComposerEditorElement>(null)
  const mounted = useRef(true)
  const inactiveRef = useRef(inactive)
  useLayoutEffect(() => {
    inactiveRef.current = inactive
  }, [inactive])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [rawDraft, setDraft] = useState<ComposerDraft>(() => {
    const workspaceId =
      workspaces.find((item) => item.id === initialDraft.workspaceId)?.id ??
      workspaces[0]?.id ??
      ""
    const provided = Object.fromEntries(
      Object.entries(initialDraft).filter(([, value]) => value !== undefined)
    )
    const candidate = bindDraftIdentity({
      text: initialDraft.text ?? "",
      model: models.includes(initialDraft.model ?? "")
        ? initialDraft.model!
        : (models[0] ?? ""),
      thinking: initialDraft.thinking ?? "中等",
      materials: initialDraft.materials ?? [],
      session: initialDraft.session ?? {
        toolIds: tools.map((tool) => tool.id),
        instructionScope: "all",
      },
      ...draftStore?.read(workspaceId),
      ...provided,
      workspaceId,
    })
    if (pendingSubmission?.draft.workspaceId !== workspaceId)
      return editableComposerDraft(candidate)
    const owned = { ...candidate, sessionId: pendingSubmission.sessionId }
    return editableComposerDraft(
      matchesHomeSubmission(owned, pendingSubmission)
        ? followingHomeDraft(owned)
        : owned
    )
  })
  const sessionSeed = useRef({
    workspaceId: rawDraft.workspaceId,
    session:
      rawDraft.text.trim() || rawDraft.materials.length
        ? rawDraft.session
        : undefined,
  })
  useLayoutEffect(() => {
    if (inactive) return
    const active = document.activeElement
    const focus = requestAnimationFrame(() => {
      if (
        document.activeElement === active ||
        document.activeElement === document.body
      )
        inputRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(focus)
  }, [rawDraft.workspaceId, inactive])
  const [saveError, setSaveError] = useState("")
  const latestDraft = useRef(rawDraft)
  const restorationRef = useRef(restoredSubmission)
  const restorationAck = useRef(onRestorationPersisted)
  useLayoutEffect(() => {
    restorationRef.current = restoredSubmission
    restorationAck.current = onRestorationPersisted
  }, [restoredSubmission, onRestorationPersisted])
  const acknowledgeRestoration = useCallback((saved: ComposerDraft) => {
    const restore = restorationRef.current
    if (
      restore &&
      saved.sessionId === restore.submission.sessionId &&
      saved.homeRecoveryKey === homeDraftRecoveryKey(restore.submission)
    )
      restorationAck.current?.(
        restore.submission.sessionId,
        restore.submission.clientRequestId
      )
  }, [])
  const updateDraft = useCallback(
    (apply: (current: ComposerDraft) => ComposerDraft, persist = true) => {
      const next = editableComposerDraft(
        bindDraftIdentity(apply(latestDraft.current))
      )
      latestDraft.current = next
      setDraft(next)
      onDraftChange?.(next)
      if (!next.workspaceId || !persist) return true
      try {
        draftStore?.write(next)
        setSaveError("")
        acknowledgeRestoration(next)
        return true
      } catch {
        setSaveError(
          "当前内容仍保留在窗口中，尚未保存到本机。请释放本地存储空间后重试保存。"
        )
        return false
      }
    },
    [
      draftStore,
      bindDraftIdentity,
      onDraftChange,
      setDraft,
      setSaveError,
      acknowledgeRestoration,
    ]
  )
  const draft = {
    ...rawDraft,
    workspaceId:
      rawDraft.workspaceId ||
      data.workspaces.find((item) => item.id === initialDraft.workspaceId)
        ?.id ||
      data.workspaces[0]?.id ||
      "",
    thinking: effectiveThinking(
      rawDraft.thinking,
      data.modelThinking?.[rawDraft.model]
    ),
  }
  const workspacePath =
    workspaces.find((item) => item.id === draft.workspaceId)?.path ?? ""
  const sessionId = rawDraft.sessionId!
  return {
    rawDraft,
    sessionId,
    workspacePath,
    anchorRef,
    anchorNode,
    bindAnchor,
    draft,
    updateDraft,
    latestDraft,
    mounted,
    inputRef,
    inactiveRef,
    sessionService,
    sessionSeed,
    saveError,
    workspaces,
    models,
    materials,
    tools,
    setWorkspaces,
    setSaveError,
    acknowledgeRestoration,
  }
}
