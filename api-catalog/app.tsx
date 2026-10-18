import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ToolLayout } from "../devtools/tool-layout"
import { useToolSearch, navigateTool } from "../devtools/location"
import { apiDocuments } from "virtual:moon-api-documents"
import { ModuleOverview } from "./module-overview"
import { schemaRows } from "./components/schema-field-table"
import { FlaskConical } from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { ModuleNavigation } from "./components/module-navigation"
import { OperationDocs } from "./components/operation-docs"
import { DeferredContent } from "./components/deferred-content"
import { operationIndex, operationUrl, moduleUrl } from "./catalog-data"
import type { FileApiDrafts } from "./file-plugin-operation"
import { useCatalogController } from "./use-catalog-controller"
import type { ModelOperation } from "@/contracts/rpc.generated"

const loadDebugPanel = () => import("./components/debug-panel")
const loadFilePluginOperation = () => import("./file-plugin-operation")
const Documentation = memo(OperationDocs)
const Navigation = memo(ModuleNavigation)
const navigationItems = Object.entries(apiDocuments).map(([id, doc]) => ({
  id,
  title: doc.definition.title,
  module: doc.module,
  effect: `${doc.definition.effect} ${[...schemaRows(doc.definition.request, doc.schemas), ...schemaRows(doc.definition.response, doc.schemas)].map((field) => `${field.path} ${field.description}`).join(" ")}`,
}))

export function ApiCatalogApp() {
  const [debugOperation, setDebugOperation] = useState<ModelOperation | null>(
    null
  )
  const page = useCatalogController(debugOperation)
  const [fileDrafts] = useState<FileApiDrafts>(() => new Map())
  const cancelFileCalls = useCallback(() => {
    for (const requests of fileDrafts.values()) requests.cancel()
  }, [fileDrafts])
  useEffect(
    () => () => {
      for (const requests of fileDrafts.values()) requests.dispose()
    },
    [fileDrafts]
  )
  useEffect(() => {
    window.addEventListener("pagehide", cancelFileCalls)
    window.addEventListener("popstate", cancelFileCalls)
    return () => {
      window.removeEventListener("pagehide", cancelFileCalls)
      window.removeEventListener("popstate", cancelFileCalls)
    }
  }, [cancelFileCalls])
  const navigate = page.navigate
  const search = useToolSearch()
  const query = new URLSearchParams(search).get("q") ?? ""
  const setQuery = (query: string) => {
    const params = new URLSearchParams(location.search)
    if (query) params.set("q", query)
    else params.delete("q")
    navigateTool(`/api-catalog/?${params}`, true)
  }
  const debugTrigger = useRef<HTMLButtonElement>(null)
  const selected = page.selection.module
    ? undefined
    : operationIndex.find((item) => item.id === page.selection.operation)
  const moduleValid =
    page.selection.module &&
    (page.selection.module === "all" ||
      navigationItems.some((item) => item.module === page.selection.module))
  const selectedDocument = !page.selection.module
    ? apiDocuments[page.selection.operation]
    : undefined
  const selectedFile =
    selectedDocument?.kind === "plugin" ? selectedDocument : undefined
  const desktop =
    selectedDocument?.kind === "desktop" ? selectedDocument : undefined
  const environment = "浏览器同源代理 → 当前 Moon 共享宿主"
  const definition = selected && page.documentation?.definition
  const draft = selected && page.drafts[selected.id]
  const input = draft?.input
  const contract = page.contract
  const selectedId = selected?.id
  const debugOpen = selectedId !== undefined && debugOperation === selectedId
  const closeDebug = useCallback(() => {
    page.requests.cancel()
    setDebugOperation(null)
    requestAnimationFrame(() => debugTrigger.current?.focus())
  }, [page.requests])
  const validationError = useMemo(() => {
    if (!selectedId || input === undefined || !contract) return null
    try {
      contract.validateRequest(selectedId, JSON.parse(input))
      return null
    } catch (error) {
      return error instanceof Error ? error.message : "参数无效。"
    }
  }, [selectedId, input, contract])
  const selectOperation = useCallback(
    (operation: string) => {
      cancelFileCalls()
      navigate(operationUrl(operation))
    },
    [navigate, cancelFileCalls]
  )
  const selectModule = useCallback(
    (module: string) => {
      cancelFileCalls()
      navigate(moduleUrl(module))
    },
    [navigate, cancelFileCalls]
  )
  const nav = (
    <Navigation
      items={navigationItems}
      selected={!page.selection.module ? page.selection.operation : undefined}
      selectedModule={page.selection.module ?? selectedDocument?.module}
      query={query}
      onQueryChange={setQuery}
      onSelect={selectOperation}
      onModuleSelect={selectModule}
    />
  )
  const unknown =
    (!page.selection.module && !selected && !selectedDocument) ||
    (page.selection.module && !moduleValid)
  return (
    <ToolLayout
      navigation={nav}
      navigationLabel="接口目录"
      selectionKey={
        page.selection.module
          ? `module:${page.selection.module}`
          : `operation:${page.selection.operation}`
      }
    >
      {unknown ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>找不到指定接口或模块</EmptyTitle>
            <EmptyDescription>
              {page.selection.module ?? page.selection.operation}{" "}
              不在当前正式契约目录中。请从导航选择，也可以返回连接目录。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => selectModule("all")}>
              返回全部模块
            </Button>
          </EmptyContent>
        </Empty>
      ) : selectedFile ? (
        <DeferredContent
          key={page.selection.operation}
          load={loadFilePluginOperation}
          props={{
            operation: page.selection.operation,
            document: selectedFile,
            environment,
            drafts: fileDrafts,
          }}
          label="文件插件接口"
          fallback={<div role="status">正在载入正式插件契约…</div>}
        />
      ) : desktop ? (
        <article className="devtools-document">
          <Documentation
            key={page.selection.operation}
            operation={page.selection.operation}
            definition={desktop.definition}
            schemas={desktop.schemas}
            facts={desktop}
          />
          <p className="devtools-muted">
            这是 Tauri
            原生命令。此网页不能执行原生调用；请从正式桌面功能入口操作。
          </p>
          {desktop.related && (
            <details>
              <summary>关联业务 RPC 契约（{desktop.related.length}）</summary>
              <ul>
                {desktop.related.map((id) => (
                  <li key={id}>
                    <a
                      href={operationUrl(id)}
                      onClick={(event) => {
                        event.preventDefault()
                        selectOperation(id)
                      }}
                    >
                      {apiDocuments[id]!.definition.title} · {id}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </article>
      ) : page.selection.module ? (
        <ModuleOverview
          module={page.selection.module}
          documents={apiDocuments}
          onSelect={selectOperation}
          onModuleSelect={selectModule}
        />
      ) : page.error ? (
        <OperationFeedback
          title="接口文档载入失败"
          message={page.error}
          notify={false}
          actions={
            <Button variant="outline" onClick={page.retry}>
              重新载入
            </Button>
          }
        />
      ) : !definition || !draft || !page.documentation ? (
        <div
          role="status"
          aria-label="载入接口详情"
          className="flex flex-col gap-4 p-6"
        >
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <article className="api-catalog-detail">
          <div className="api-document-actions">
            <Button
              ref={debugTrigger}
              variant="outline"
              size="sm"
              onClick={() => setDebugOperation(selected!.id)}
            >
              <FlaskConical data-icon="inline-start" />
              调试接口
            </Button>
          </div>
          <section className="api-catalog-docs">
            <Documentation
              key={selected!.id}
              operation={selected!.id}
              definition={definition}
              schemas={page.documentation.schemas}
              facts={selectedDocument}
            />
          </section>
          <Dialog
            open={debugOpen}
            onOpenChange={(open) => {
              if (!open) closeDebug()
            }}
          >
            <DialogContent variant="reader" className="api-debug-dialog">
              <DialogTitle>调试 · {definition.title}</DialogTitle>
              {debugOpen && page.contractError ? (
                <OperationFeedback
                  title="调试契约载入失败"
                  message={page.contractError}
                  notify={false}
                  actions={
                    <>
                      <Button variant="outline" onClick={page.retry}>
                        重新载入
                      </Button>
                      <Button variant="ghost" onClick={closeDebug}>
                        收起调试
                      </Button>
                    </>
                  }
                />
              ) : debugOpen && !page.contract ? (
                <div className="api-deferred-loading" role="status">
                  正在载入调试契约…
                  <Button variant="ghost" size="sm" onClick={closeDebug}>
                    取消打开
                  </Button>
                </div>
              ) : debugOpen ? (
                <DeferredContent
                  load={loadDebugPanel}
                  label="接口调试面板"
                  onDismiss={closeDebug}
                  fallback={
                    <div className="api-deferred-loading" role="status">
                      正在载入调试面板…
                      <Button variant="ghost" size="sm" onClick={closeDebug}>
                        取消打开
                      </Button>
                    </div>
                  }
                  props={{
                    focusOnMount: true,
                    request: {
                      operation: selected!.id,
                      title: definition.title,
                      value: draft.input,
                      dirty: draft.dirty,
                      validationError,
                      busy: draft.response.status === "running",
                      environment,
                      effect: definition.effect,
                      onChange: (value: string) =>
                        page.requests.setInput(selected!.id, value),
                      onRestoreExample: () =>
                        page.requests.restore(selected!.id),
                      onClear: () => page.requests.setInput(selected!.id, ""),
                      onRun: () => {
                        void page.requests.run(
                          selected!.id,
                          page.contract!.validateRequest
                        )
                      },
                      onCancel: page.requests.cancel,
                    },
                    response: {
                      response: draft.response,
                      onClear: () => page.requests.clearResponse(selected!.id),
                    },
                    onClose: closeDebug,
                  }}
                />
              ) : null}
            </DialogContent>
          </Dialog>
        </article>
      )}
    </ToolLayout>
  )
}
