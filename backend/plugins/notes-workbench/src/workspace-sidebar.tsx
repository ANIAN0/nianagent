// 左侧导航（T08）：项目 → 目录树 → 草稿；搜索/类型筛选/改名/移动/归档恢复。
// 草稿元数据操作经 update_draft（metadataRevision 并发保护 + requestKey 幂等）。
import {
  Moon,
  Search,
  Folder,
  FileText,
  Workflow,
  PanelsTopLeft,
  MoreHorizontal,
  Plus,
} from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { NativeSelect } from "./ui/native-select"
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group"
import { memo, useRef, useState, type ReactNode } from "react"
import { kindLabel } from "./reader-registry"
import {
  newRequestKey,
  type V2Directory,
  type V2Draft,
  type V2Project,
} from "./v2-api"
import {
  OrganizationEditor,
  type OrganizationAction,
} from "./organization-editor"

export type SidebarProps = {
  projects: V2Project[]
  directories: V2Directory[]
  drafts: V2Draft[]
  /** AC18：已归档草稿（恢复浏览入口）；主列表默认仅未归档。 */
  archivedDrafts: V2Draft[]
  draftId: string | null
  kindFilter: "" | "markdown" | "board" | "ui"
  search: string
  onKindFilter: (kind: "" | "markdown" | "board" | "ui") => void
  onSearch: (value: string) => void
  onSelectDraft: (draftId: string | null) => void
  /** 元数据操作（改名/移动/归档恢复）；失败由壳层错误横幅呈现。 */
  onPatchDraft: (
    draftId: string,
    patch: {
      title?: string
      directoryId?: string
      archived?: boolean
      metadataRevision: number
    },
    requestKey: string
  ) => Promise<boolean>
  onRefresh: () => Promise<void>
}

const kindIcons = { markdown: FileText, board: Workflow, ui: PanelsTopLeft }

export const NavigationSidebar = memo(function NavigationSidebar(
  props: SidebarProps
) {
  const [editing, setEditing] = useState<OrganizationAction | null>(null)
  const kinds: ("" | "markdown" | "board" | "ui")[] = [
    "",
    "markdown",
    "board",
    "ui",
  ]
  const matches = (draft: V2Draft) =>
    (props.kindFilter === "" || draft.kind === props.kindFilter) &&
    (!props.search ||
      draft.title.toLowerCase().includes(props.search.toLowerCase()))
  const filtered = props.drafts.filter(matches)
  const archived = props.archivedDrafts.filter(matches)
  const childrenOf = (parentId: string | null, projectId: string) =>
    props.directories.filter(
      (directory) =>
        !directory.archivedAt &&
        directory.projectId === projectId &&
        (directory.parentId ?? null) === parentId
    )
  const draftsIn = (directoryId: string) =>
    filtered.filter((draft) => draft.directoryId === directoryId)
  const orphans = filtered.filter(
    (draft) => !props.projects.some((project) => project.id === draft.projectId)
  )

  const renderDirectory = (
    directory: V2Directory,
    depth: number
  ): ReactNode => {
    const children = childrenOf(directory.id, directory.projectId)
    const drafts = draftsIn(directory.id)
    return (
      <div key={directory.id}>
        <div
          className="flex items-center gap-2 truncate py-2 text-xs font-medium text-muted-foreground"
          style={{ paddingLeft: 12 + depth * 12 }}
        >
          <Folder className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{directory.name}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`在${directory.name}中新建目录`}
            onClick={() =>
              setEditing({
                kind: "createDirectory",
                projectId: directory.projectId,
                parentId: directory.id,
              })
            }
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`管理目录${directory.name}`}
            onClick={() => setEditing({ kind: "directory", item: directory })}
          >
            <MoreHorizontal />
          </Button>
        </div>
        {children.map((child) => renderDirectory(child, depth + 1))}
        {drafts.map((draft) => (
          <DraftRow key={draft.id} draft={draft} depth={depth + 1} {...props} />
        ))}
      </div>
    )
  }

  return (
    <nav
      aria-label="项目与草稿"
      className="flex w-full shrink-0 flex-col border-r bg-background/60 lg:w-64"
    >
      <div className="flex h-16 items-center gap-2.5 border-b px-5">
        <Button
          variant="ghost"
          className="gap-2.5 px-0"
          aria-label="返回工作台首页"
          onClick={() => props.onSelectDraft(null)}
        >
          <Moon className="size-5 text-primary" />
          <strong className="text-base tracking-tight">MOON</strong>
          <span className="text-sm text-muted-foreground">工作台</span>
        </Button>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
          />
          <Input
            aria-label="搜索草稿"
            className="pl-8"
            placeholder="搜索草稿…"
            value={props.search}
            onChange={(event) => props.onSearch(event.target.value)}
          />
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          value={props.kindFilter || "all"}
          onValueChange={(value) => {
            if (value)
              props.onKindFilter(
                value === "all" ? "" : (value as SidebarProps["kindFilter"])
              )
          }}
          aria-label="内容类型"
        >
          {kinds.map((kind) => (
            <ToggleGroupItem key={kind || "all"} value={kind || "all"}>
              {kind === "" ? "全部" : kindLabel(kind)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-4">
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 w-full justify-start"
          onClick={() => setEditing({ kind: "createProject" })}
        >
          <Plus />
          新建项目
        </Button>
        {editing && (
          <OrganizationEditor
            key={JSON.stringify(editing)}
            action={editing}
            directories={props.directories}
            onRefresh={props.onRefresh}
            onClose={() => setEditing(null)}
          />
        )}
        {props.projects.length === 0 && props.drafts.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            还没有项目。让 Agent 发布第一份草稿后，即可在这里审阅。
          </p>
        )}
        {props.projects
          .filter((project) => !project.archivedAt)
          .map((project) => {
            const roots = childrenOf(null, project.id)
            const projectDrafts = filtered.filter(
              (draft) =>
                draft.projectId === project.id &&
                !props.directories.some(
                  (directory) => directory.id === draft.directoryId
                )
            )
            return (
              <div key={project.id} className="mb-1">
                <div className="flex items-center gap-1 pt-3 pl-3 text-xs font-semibold text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">
                    {project.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`在${project.name}中新建目录`}
                    onClick={() =>
                      setEditing({
                        kind: "createDirectory",
                        projectId: project.id,
                      })
                    }
                  >
                    <Plus />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`管理项目${project.name}`}
                    onClick={() =>
                      setEditing({ kind: "project", item: project })
                    }
                  >
                    <MoreHorizontal />
                  </Button>
                </div>
                {roots.map((root) => renderDirectory(root, 0))}
                {projectDrafts.map((draft) => (
                  <DraftRow key={draft.id} draft={draft} depth={0} {...props} />
                ))}
              </div>
            )
          })}
        {orphans.map((draft) => (
          <DraftRow key={draft.id} draft={draft} depth={0} {...props} />
        ))}
        {(props.archivedDrafts.length > 0 ||
          props.projects.some((project) => project.archivedAt) ||
          props.directories.some((directory) => directory.archivedAt)) && (
          <details className="mt-2 border-t pt-1">
            <summary className="cursor-pointer px-2 py-1 text-xs text-muted-foreground">
              已归档
            </summary>
            {props.projects
              .filter((project) => project.archivedAt)
              .map((project) => (
                <Button
                  key={project.id}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setEditing({ kind: "project", item: project })}
                >
                  项目 · {project.name}
                </Button>
              ))}
            {props.directories
              .filter((directory) => directory.archivedAt)
              .map((directory) => (
                <Button
                  key={directory.id}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() =>
                    setEditing({ kind: "directory", item: directory })
                  }
                >
                  目录 · {directory.name}
                </Button>
              ))}
            {archived.map((draft) => (
              <DraftRow key={draft.id} draft={draft} depth={0} {...props} />
            ))}
          </details>
        )}
      </div>
    </nav>
  )
})

function DraftRow(
  props: SidebarProps & {
    draft: V2Draft
    depth: number
  }
) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(props.draft.title)
  const [saving, setSaving] = useState(false)
  const request = useRef({ signature: "", key: "" })
  const { draft } = props
  const KindIcon = kindIcons[draft.kind as keyof typeof kindIcons] ?? FileText
  const patch = async (body: {
    title?: string
    directoryId?: string
    archived?: boolean
  }) => {
    if (saving) return
    const signature = JSON.stringify({
      ...body,
      metadataRevision: draft.metadataRevision,
    })
    if (request.current.signature !== signature)
      request.current = { signature, key: newRequestKey() }
    setSaving(true)
    try {
      if (
        await props.onPatchDraft(
          draft.id,
          { metadataRevision: draft.metadataRevision, ...body },
          request.current.key
        )
      ) {
        setMenuOpen(false)
        setRenaming(false)
      }
    } finally {
      setSaving(false)
    }
  }
  return (
    <div>
      <div
        className="group flex items-center gap-1 py-0.5 pr-1"
        style={{ paddingLeft: 6 + props.depth * 10 }}
      >
        <Button
          variant={props.draftId === draft.id ? "secondary" : "ghost"}
          className="min-w-0 flex-1 justify-start"
          aria-current={props.draftId === draft.id ? "page" : undefined}
          onClick={() => props.onSelectDraft(draft.id)}
        >
          <KindIcon data-icon="inline-start" />
          <span
            className={`truncate ${draft.archivedAt ? "line-through" : ""}`}
          >
            {draft.title}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${draft.title}的操作`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal />
        </Button>
      </div>
      {menuOpen && (
        <div
          className="mx-2 mb-1 rounded border bg-card p-2 text-xs shadow-sm"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !saving) {
              setMenuOpen(false)
              setRenaming(false)
            }
          }}
        >
          {renaming ? (
            <div className="flex gap-1">
              <Input
                aria-label="草稿名称"
                autoFocus
                disabled={saving}
                className="min-w-0 flex-1"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && title.trim() && !saving) {
                    event.preventDefault()
                    void patch({ title: title.trim() })
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={saving || !title.trim()}
                className="rounded border px-1.5 py-0.5"
                onClick={() => {
                  if (title.trim() && title !== draft.title)
                    void patch({ title: title.trim() })
                  else {
                    setRenaming(false)
                    setMenuOpen(false)
                  }
                }}
              >
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={() => {
                  setTitle(draft.title)
                  setRenaming(true)
                }}
              >
                改名
              </Button>
              <label className="flex items-center gap-1">
                移动至
                <NativeSelect
                  className="min-w-0 flex-1"
                  value={draft.directoryId}
                  onChange={(event) => {
                    if (event.target.value !== draft.directoryId)
                      patch({ directoryId: event.target.value })
                  }}
                >
                  {props.directories
                    .filter(
                      (directory) => directory.projectId === draft.projectId
                    )
                    .map((directory) => (
                      <option key={directory.id} value={directory.id}>
                        {directory.name}
                      </option>
                    ))}
                </NativeSelect>
              </label>
              {props.archivedDrafts.some((item) => item.id === draft.id) &&
              !draft.archivedAt ? (
                <p className="py-1 text-muted-foreground">
                  所属项目或目录已归档，请先恢复上级。
                </p>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={() => patch({ archived: !draft.archivedAt })}
                >
                  {draft.archivedAt ? "恢复" : "归档"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={() => setMenuOpen(false)}
              >
                关闭
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
