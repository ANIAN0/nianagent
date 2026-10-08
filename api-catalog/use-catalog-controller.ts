import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import {
  loadContract,
  loadOperationDocs,
  readLocation,
  operationIndex,
} from "./catalog-data"
import { createRequestController } from "./request-controller"
import type { ModelOperation, RpcRequests } from "@/contracts/rpc.generated"

export function useCatalogController(debugOperation: ModelOperation | null) {
  const [selection, setSelection] = useState(readLocation)
  const [document, setDocument] = useState<{
    operation: ModelOperation
    data: Awaited<ReturnType<typeof loadOperationDocs>>
  }>()
  const [contract, setContract] =
    useState<Awaited<ReturnType<typeof loadContract>>>()
  const [documentError, setDocumentError] = useState<{
    operation: string
    text: string
  }>()
  const [contractError, setContractError] = useState("")
  const [revision, setRevision] = useState(0)
  const needsDocs =
    !selection.module &&
    operationIndex.some((item) => item.id === selection.operation)
  const needsContract = needsDocs && debugOperation === selection.operation
  const [requests] = useState(() =>
    createRequestController(async (operation, input, signal) => {
      const { rpcCall } = await import("@/lib/rpc/client")
      signal.throwIfAborted()
      return rpcCall(operation, input as RpcRequests[typeof operation], signal)
    })
  )
  const drafts = useSyncExternalStore(requests.subscribe, requests.getSnapshot)
  useEffect(() => {
    if (!needsDocs) return
    const operation = selection.operation as ModelOperation
    let mounted = true
    void loadOperationDocs(operation).then(
      (loaded) => {
        if (!mounted) return
        requests.initialize({ [operation]: loaded.definition })
        setDocument({ operation, data: loaded })
        setDocumentError(undefined)
      },
      (cause: unknown) => {
        if (mounted)
          setDocumentError({
            operation,
            text: cause instanceof Error ? cause.message : "文档载入失败。",
          })
      }
    )
    return () => {
      mounted = false
    }
  }, [requests, revision, needsDocs, selection.operation])
  useEffect(() => {
    if (!needsContract || contract) return
    let mounted = true
    void loadContract().then(
      (loaded) => {
        if (!mounted) return
        setContract(loaded)
        setContractError("")
      },
      (cause: unknown) => {
        if (mounted)
          setContractError(
            cause instanceof Error ? cause.message : "契约载入失败。"
          )
      }
    )
    return () => {
      mounted = false
    }
  }, [requests, revision, needsContract, contract])
  useEffect(() => {
    const change = () => {
      requests.cancel()
      setSelection(readLocation())
    }
    window.addEventListener("popstate", change)
    window.addEventListener("pagehide", requests.cancel)
    return () => {
      window.removeEventListener("popstate", change)
      window.removeEventListener("pagehide", requests.cancel)
    }
  }, [requests])
  useEffect(() => () => requests.dispose(), [requests])
  const navigate = useCallback(
    (url: string) => {
      requests.cancel()
      history.pushState(null, "", url)
      setSelection(readLocation())
    },
    [requests]
  )
  return {
    selection,
    documentation:
      document?.operation === selection.operation ? document.data : undefined,
    contract,
    error:
      documentError?.operation === selection.operation
        ? documentError.text
        : "",
    contractError,
    drafts,
    requests,
    navigate,
    retry: () => {
      setDocumentError(undefined)
      setContractError("")
      setRevision((old) => old + 1)
    },
  }
}
