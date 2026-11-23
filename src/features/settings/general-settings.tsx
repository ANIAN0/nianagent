import { useMemo, useState } from "react"
import {
  FolderPlus,
  Keyboard,
  Monitor,
  Moon,
  Search,
  Sun,
  X,
} from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { DataTablePagination } from "@/components/ui/pagination"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableCellText,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Workspace } from "@/lib/composer/types"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { shortcutLabel } from "@/lib/platform-shortcut"

const THEME_OPTIONS = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
] as const

const SHORTCUTS = [
  { action: "新建会话", keys: () => shortcutLabel("N") },
  { action: "搜索会话", keys: () => shortcutLabel("K") },
  { action: "开关导航", keys: () => shortcutLabel("B") },
  { action: "切换浅色和深色", keys: () => "D" },
] as const

const DEFAULT_PAGE_SIZE = 10

export type WorkspaceSettingsPort = {
  items: Workspace[]
  selectedId?: string
  initialLoading: boolean
  issue?: FeedbackDescription
  choose: () => Promise<Workspace | null>
  select: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

export function GeneralSettings({
  workspaces,
}: {
  workspaces: WorkspaceSettingsPort
}) {
  const { theme, setTheme } = useTheme()
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState<FeedbackDescription>()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)

  const workspaceIssue = issue ?? workspaces.issue
  const term = query.trim().toLocaleLowerCase()

  const filtered = useMemo(() => {
    if (!term) return workspaces.items
    return workspaces.items.filter((item) =>
      `${item.name} ${item.path}`.toLocaleLowerCase().includes(term)
    )
  }, [workspaces.items, term])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageItems = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize]
  )

  async function changeWorkspace(action: () => Promise<unknown>) {
    setBusy(true)
    setIssue(undefined)
    try {
      await action()
    } catch (error) {
      setIssue(feedbackFromError(error, "工作目录未能更新。"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-page-inner">
        <header>
          <h2>通用与外观</h2>
        </header>

        <Card>
          <CardContent className="grid grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 lg:pr-6 lg:pb-0">
              <span className="text-sm font-medium text-foreground">主题</span>
              <Tabs
                value={theme}
                onValueChange={(value) =>
                  setTheme(value as "system" | "light" | "dark")
                }
              >
                <TabsList aria-label="主题">
                  {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5"
                    >
                      <Icon />
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 lg:pt-0 lg:pl-6">
              <span className="text-sm font-medium text-foreground">
                键盘快捷键
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setShortcutsOpen(true)}
              >
                <Keyboard data-icon="inline-start" />
                查看快捷键
              </Button>
            </div>
          </CardContent>
        </Card>

        <section className="flex flex-col gap-3" aria-label="工作目录">
          <h3>工作目录</h3>

          {workspaceIssue && (
            <OperationFeedback
              title="工作目录未能读取或更新"
              {...workspaceIssue}
              notify={false}
              actions={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void changeWorkspace(workspaces.refresh)}
                >
                  重新读取
                </Button>
              }
            />
          )}

          {workspaces.items.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <InputGroup className="h-8 w-full max-w-xs">
                <InputGroupAddon>
                  <Search className="size-3.5" />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="筛选工作目录"
                  placeholder="按名称或路径筛选"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setPage(1)
                  }}
                />
                {query && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label="清空筛选"
                      onClick={() => {
                        setQuery("")
                        setPage(1)
                      }}
                    >
                      <X />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={busy}
                onClick={() => void changeWorkspace(workspaces.choose)}
              >
                <FolderPlus data-icon="inline-start" />
                添加目录
              </Button>
            </div>
          )}

          {workspaces.initialLoading ? (
            <p role="status" className="flex items-center gap-2 py-8">
              <Spinner />
              正在读取工作目录…
            </p>
          ) : pageItems.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table variant="compact" className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-[26%]">目录</TableHead>
                    <TableHead>路径</TableHead>
                    <TableHead className="w-[104px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((workspace) => {
                    const isDefault = workspace.id === workspaces.selectedId
                    return (
                      <TableRow key={workspace.id}>
                        <TableCell className="align-middle font-medium text-foreground">
                          <div className="flex min-w-0 items-center gap-2">
                            <TableCellText
                              text={workspace.name}
                              className="min-w-0"
                            />
                            {isDefault && (
                              <Badge variant="secondary">默认</Badge>
                            )}
                          </div>
                          {workspace.unavailableReason && (
                            <TableCellText
                              text={workspace.unavailableReason}
                              className="mt-0.5 text-xs font-normal text-destructive"
                            />
                          )}
                        </TableCell>
                        <TableCell
                          variant="secondary"
                          className="align-middle font-mono"
                        >
                          <TableCellText text={workspace.path} />
                        </TableCell>
                        <TableCell className="text-right align-middle whitespace-nowrap">
                          {isDefault ? (
                            <span aria-hidden="true" className="block h-7" />
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              disabled={busy || workspace.available === false}
                              onClick={() =>
                                void changeWorkspace(() =>
                                  workspaces.select(workspace.id)
                                )
                              }
                            >
                              设为默认
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          ) : !workspaceIssue && workspaces.items.length > 0 ? (
            <Empty className="rounded-lg border border-border py-10">
              <EmptyHeader>
                <EmptyTitle className="text-sm font-normal">
                  未找到匹配的工作目录
                </EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery("")
                    setPage(1)
                  }}
                >
                  清空筛选
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            !workspaceIssue && (
              <Empty className="rounded-lg border border-border py-10">
                <EmptyHeader>
                  <EmptyTitle className="text-sm font-normal">
                    尚未添加工作目录
                  </EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void changeWorkspace(workspaces.choose)}
                  >
                    <FolderPlus data-icon="inline-start" />
                    添加目录
                  </Button>
                </EmptyContent>
              </Empty>
            )
          )}

          {!workspaces.initialLoading && workspaces.items.length > 0 && (
            <DataTablePagination
              total={workspaces.items.length}
              filteredTotal={filtered.length}
              filtered={!!term}
              page={currentPage}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              itemLabel="个目录"
            />
          )}
        </section>

        <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>键盘快捷键</DialogTitle>
            </DialogHeader>
            <div className="overflow-hidden rounded-lg border border-border">
              <Table variant="compact">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>操作</TableHead>
                    <TableHead className="w-[120px] text-right">
                      快捷键
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SHORTCUTS.map((item) => (
                    <TableRow key={item.action}>
                      <TableCell className="text-foreground">
                        {item.action}
                      </TableCell>
                      <TableCell className="text-right">
                        <Kbd>{item.keys()}</Kbd>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
