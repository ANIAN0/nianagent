import { useEffect, useRef, useState } from "react"
import { thinkingLabels } from "@/features/home/model-thinking"
import type { HomeData } from "@/features/home/home-types"
import { createModelService } from "./model-service"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import {
  connectionIssue,
  modelSelectionId,
  type ModelConnection,
} from "./model-types"

/** One source for the settings page and both composer model menus. */
export function useModelCatalog(onOpenSettings: () => void) {
  const [service] = useState(createModelService)
  const [connections, setConnections] = useState<ModelConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [issue, setIssue] = useState<FeedbackDescription>()
  const [version, setVersion] = useState(0)
  const [labels, setLabels] = useState<Record<string, string>>({})
  const sequence = useRef(0)
  useEffect(() => {
    const request = ++sequence.current
    const controller = new AbortController()
    service
      .list(controller.signal)
      .then((items) => {
        if (controller.signal.aborted || request !== sequence.current) return
        if (
          items.some((connection) =>
            connection.models.some(
              (model) => !Array.isArray(model.supportedThinkingLevels)
            )
          )
        )
          throw Object.assign(
            new Error("模型服务版本不匹配，请重新启动 Moon。"),
            {
              issue: {
                code: "host_version",
                summary: "模型服务版本不匹配，请重新启动 Moon。",
                recovery: "restart",
                severity: "error",
              },
            }
          )
        setConnections(items)
        setLabels((previous) => ({
          ...previous,
          ...Object.fromEntries(
            items.flatMap((connection) =>
              connection.models.map((model) => [
                modelSelectionId(connection, model),
                `${model.name} · ${connection.name}`,
              ])
            )
          ),
        }))
        setError("")
        setIssue(undefined)
        setLoading(false)
      })
      .catch((failure) => {
        if (!controller.signal.aborted && request === sequence.current) {
          const feedback = feedbackFromError(
            failure,
            "模型目录未能读取，请重新读取。"
          )
          setError(feedback.message)
          setIssue(
            feedback.code === "cancelled"
              ? { ...feedback, recovery: "reload" }
              : feedback
          )
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [service, version])
  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1)
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [])
  const usable = connections.filter(
    (connection) => !connectionIssue(connection)
  )
  const data: Pick<
    HomeData,
    "models" | "modelLabels" | "modelThinking" | "modelCatalog" | "modelInputs"
  > = {
    models: usable.flatMap((connection) =>
      connection.models.map((model) => modelSelectionId(connection, model))
    ),
    modelLabels: labels,
    modelInputs: Object.fromEntries(
      connections.flatMap((connection) =>
        connection.models.map((model) => [
          modelSelectionId(connection, model),
          model.input,
        ])
      )
    ),
    modelThinking: Object.fromEntries(
      connections.flatMap((connection) =>
        connection.models.map((model) => [
          modelSelectionId(connection, model),
          (model.supportedThinkingLevels ?? []).map(
            (level) => thinkingLabels[level] ?? level
          ),
        ])
      )
    ),
    modelCatalog: {
      items: usable.flatMap((connection) =>
        connection.models.map((model) => ({
          value: modelSelectionId(connection, model),
          name: model.name,
          connection: connection.name,
          modelId: model.id,
        }))
      ),
      status: loading ? "loading" : error ? "error" : "ready",
      error,
      issue,
      onRetry: () => {
        setLoading(true)
        setVersion((value) => value + 1)
      },
      onOpenSettings,
    },
  }
  return {
    service,
    connections,
    data,
    error,
    issue,
    update: (items: ModelConnection[]) => {
      ++sequence.current
      setConnections(items)
      setLoading(false)
      setLabels((previous) => ({
        ...previous,
        ...Object.fromEntries(
          items.flatMap((connection) =>
            connection.models.map((model) => [
              modelSelectionId(connection, model),
              `${model.name} · ${connection.name}`,
            ])
          )
        ),
      }))
      setError("")
      setIssue(undefined)
      setVersion((value) => value + 1)
    },
  }
}
