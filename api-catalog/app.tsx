import { memo, useCallback, useMemo, useRef, useState } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { FlaskConical } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { CatalogHeader } from "./components/catalog-header"
import { ModuleNavigation } from "./components/module-navigation"
import { OperationDocs } from "./components/operation-docs"
import { DeferredContent } from "./components/deferred-content"
import { operationIndex, operationUrl, moduleUrl } from "./catalog-data"
import { useCatalogController } from "./use-catalog-controller"
import type { ModelOperation } from "@/contracts/rpc.generated"

const loadArchitecturePanel = () => import("./architecture-panel")
const loadDebugPanel = () => import("./components/debug-panel")
const loadNavigationDialog = () => import("./components/navigation-dialog")
const Documentation = memo(OperationDocs)
const Navigation = memo(ModuleNavigation)
const navigationItems = [...operationIndex]

export function ApiCatalogApp() {
  const [debugOperation, setDebugOperation] = useState<ModelOperation | null>(
    null
  )
  const page = useCatalogController(debugOperation)
  const navigate = page.navigate
  const { theme, setTheme } = useTheme()
  const [query, setQuery] = useState("")
  const [navigationOpen, setNavigationOpen] = useState(false)
  const navigationTrigger = useRef<HTMLElement | null>(null)
  const debugTrigger = useRef<HTMLButtonElement>(null)
  const closePendingNavigation = useCallback(() => {
    setNavigationOpen(false)
    requestAnimationFrame(() => navigationTrigger.current?.focus())
  }, [])
  const selected = page.selection.module
    ? undefined
    : operationIndex.find((item) => item.id === page.selection.operation)
  const moduleValid =
    page.selection.module &&
    operationIndex.some((item) => item.module === page.selection.module)
  const environment = isTauri()
    ? "Tauri → Moon 共享宿主"
    : "浏览器同源代理 → Moon 共享宿主"
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
    (operation: ModelOperation) => {
      navigate(operationUrl(operation))
      setNavigationOpen(false)
    },
    [navigate]
  )
  const selectModule = useCallback(
    (module: string) => {
      navigate(moduleUrl(module))
      setNavigationOpen(false)
    },
    [navigate]
  )
  const nav = (
    <Navigation
      items={navigationItems}
      selected={selected?.id}
      selectedModule={page.selection.module ?? undefined}
      query={query}
      onQueryChange={setQuery}
      onSelect={selectOperation}
      onModuleSelect={selectModule}
    />
  )
  const unknown =
    (!page.selection.module && !selected) ||
    (page.selection.module && !moduleValid)
  return (
    <div className="api-catalog-root">
      <CatalogHeader
        environment={environment}
        theme={theme}
        onThemeChange={setTheme}
        onOpenNavigation={() => {
          navigationTrigger.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
          setNavigationOpen(true)
        }}
        onLeave={page.requests.cancel}
      />
      <div className="api-catalog-layout">
        <aside className="api-catalog-sidebar">{nav}</aside>
        <main className="api-catalog-workspace">
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
                <Button
                  variant="outline"
                  onClick={() => page.navigate(operationUrl("list"))}
                >
                  返回连接目录
                </Button>
              </EmptyContent>
            </Empty>
          ) : page.selection.module ? (
            <DeferredContent
              load={loadArchitecturePanel}
              props={{ module: page.selection.module }}
              label="模块架构"
              fallback={
                <div className="api-deferred-loading" role="status">
                  正在载入模块架构…
                </div>
              }
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
            <div
              className="api-catalog-detail-grid"
              data-debug-open={debugOpen}
            >
              <section className="api-catalog-docs">
                <Documentation
                  key={selected!.id}
                  operation={selected!.id}
                  definition={definition}
                  schemas={page.documentation.schemas}
                />
              </section>
              <section
                className="api-catalog-tester"
                aria-label="接口调试"
                id="api-catalog-debug"
              >
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
                        onClear: () =>
                          page.requests.clearResponse(selected!.id),
                      },
                      onClose: closeDebug,
                    }}
                  />
                ) : (
                  <div className="api-debug-launcher">
                    <FlaskConical aria-hidden="true" />
                    <h3>调试此接口</h3>
                    <p>编辑请求参数，查看真实返回。打开面板不会发起调用。</p>
                    <dl>
                      <dt>调用环境</dt>
                      <dd>{environment}</dd>
                      <dt>数据影响</dt>
                      <dd>{definition.effect}</dd>
                    </dl>
                    {draft.response.status !== "idle" && (
                      <p className="api-debug-draft-note">
                        本接口的草稿与上次调用结果已保留。
                      </p>
                    )}
                    <Button
                      ref={debugTrigger}
                      onClick={() => setDebugOperation(selected!.id)}
                      aria-controls="api-catalog-debug"
                      aria-expanded={false}
                    >
                      打开调试面板
                    </Button>
                  </div>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
      {navigationOpen && (
        <DeferredContent
          load={loadNavigationDialog}
          label="接口导航"
          onDismiss={closePendingNavigation}
          props={{
            children: nav,
            onOpenChange: setNavigationOpen,
            onReturnFocus: () => navigationTrigger.current?.focus(),
          }}
          fallback={
            <div className="api-navigation-pending" role="status">
              正在打开接口导航…
              <Button
                variant="ghost"
                size="sm"
                onClick={closePendingNavigation}
              >
                取消
              </Button>
            </div>
          }
        />
      )}
    </div>
  )
}
