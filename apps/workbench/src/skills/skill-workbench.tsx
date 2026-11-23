"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FolderOutput,
  Moon as MoonIcon,
  PanelLeft,
  Sun,
} from "lucide-react"
import { Badge } from "@/ui/badge"
import { Button } from "@/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group"
import {
  api,
  type BlockLineage,
  type SkillDetail,
  type SkillSummary,
  type VersionCompare,
} from "./api"
import { BlocksTab } from "./blocks-tab"
import { LineageTab } from "./lineage-tab"
import {
  ConfirmDeleteSkillDialog,
  CreateSkillDialog,
  ExportSkillDialog,
  PromptReasonDialog,
  type PromptDialogConfig,
} from "./skill-dialogs"
import { SkillSidebar } from "./skill-sidebar"

type TabId = "blocks" | "lineage"
const THEME_KEY = "moon-notes-theme"

export function SkillWorkbench() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [loadedDetail, setLoadedDetail] = useState<SkillDetail | null>(null)
  const detail = loadedDetail?.skill.id === selectedId ? loadedDetail : null
  const selection = useRef("")
  const detailRequest = useRef(0)
  const [detailError, setDetailError] = useState("")
  const [listError, setListError] = useState("")
  const [tab, setTab] = useState<TabId>("blocks")
  const [search, setSearch] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light"
    try {
      return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"
    } catch {
      return "light"
    }
  })

  // Dialogs
  const [showNewSkill, setShowNewSkill] = useState(false)
  const [exportTarget, setExportTarget] = useState<SkillDetail | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null)
  const [promptConfig, setPromptConfig] = useState<PromptDialogConfig | null>(
    null
  )
  const [promptKey, setPromptKey] = useState(0)

  // Lineage & version compare
  const [fromVer, setFromVer] = useState<number | null>(null)
  const [toVer, setToVer] = useState(0)
  const [comparison, setComparison] = useState<{
    path: string
    revision: number | undefined
    version: number | undefined
    data: VersionCompare
  } | null>(null)
  const [lineage, setLineage] = useState<BlockLineage | null>(null)

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark"
    setTheme(next)
    document.documentElement.classList.remove("light", "dark")
    document.documentElement.classList.add(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* ignore storage errors */
    }
  }

  const closeSidebarOnNarrowScreen = () => {
    if (window.matchMedia("(width < 48rem)").matches) setSidebarOpen(false)
  }

  const openPrompt = (config: PromptDialogConfig) => {
    setPromptKey((k) => k + 1)
    setPromptConfig(config)
  }

  const loadDetail = useCallback(async (skillId: string) => {
    if (selection.current !== skillId) return
    const request = ++detailRequest.current
    setDetailError("")
    try {
      const next = await api<SkillDetail>("/api/skills/" + encodeURIComponent(skillId))
      if (request !== detailRequest.current) return
      setLoadedDetail(next)
      setSkills((items) => items.map((skill) => skill.id === skillId ? next.skill : skill))
      const available = (version: number) => version === 0 ||
        next.versions.some((item) => item.versionNumber === version)
      setFromVer((version) => version !== null && available(version) ? version : null)
      setToVer((version) => available(version) ? version : 0)
    } catch (error) {
      if (request !== detailRequest.current) return
      setDetailError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const selectSkill = useCallback((skillId: string, created?: SkillDetail) => {
    if (selection.current === skillId && !created) return
    selection.current = skillId
    detailRequest.current += 1
    setSelectedId(skillId)
    setLoadedDetail(created ?? null)
    setDetailError("")
    setFromVer(null)
    setToVer(0)
    setComparison(null)
    setLineage(null)
    if (skillId && !created) void loadDetail(skillId)
  }, [loadDetail])

  const loadSkills = useCallback(async () => {
    const { skills } = await api<{ skills: SkillSummary[] }>("/api/skills")
    setSkills(skills)
    if (!skills.some((skill) => skill.id === selection.current)) {
      selectSkill(skills[0]?.id ?? "")
    }
    return skills
  }, [selectSkill])

  const reloadSkills = useCallback(async () => {
    setLoading(true)
    setListError("")
    try {
      await loadSkills()
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [loadSkills])

  useEffect(() => {
    let cancelled = false
    void api<{ skills: SkillSummary[] }>("/api/skills")
      .then(({ skills }) => {
        if (cancelled) return
        setSkills(skills)
        selectSkill(skills[0]?.id ?? "")
      })
      .catch((error) => {
        if (!cancelled) setListError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      detailRequest.current += 1
    }
  }, [selectSkill])

  const fromVersion = fromVer ?? detail?.versions[0]?.versionNumber ?? 0
  const comparePath = detail && tab === "lineage"
    ? "/api/skills/" + encodeURIComponent(selectedId) + "/compare?from=" + fromVersion + "&to=" + toVer
    : ""
  const compareRevision = detail?.skill.draftRevision
  const compareVersion = detail?.skill.currentVersion
  const compareData = comparison?.path === comparePath &&
    comparison.revision === compareRevision && comparison.version === compareVersion
    ? comparison.data
    : null

  useEffect(() => {
    if (!comparePath) return
    const controller = new AbortController()
    void api<VersionCompare>(comparePath, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setComparison({ path: comparePath, revision: compareRevision, version: compareVersion, data })
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error))
      })
    return () => controller.abort()
  }, [comparePath, compareRevision, compareVersion])

  // Poll host revision for external Pi tool updates.
  useEffect(() => {
    let lastRev: number | undefined
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const { revision } = await api<{ revision: number }>("/api/revision")
        if (!cancelled && lastRev !== undefined && revision !== lastRev) {
          if (selection.current) void loadDetail(selection.current)
        }
        lastRev = revision
      } catch {
        // A later poll can resume after reconnecting.
      } finally {
        if (!cancelled) timer = setTimeout(poll, 2500)
      }
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [loadDetail])

  const filteredSkills = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    )
  }, [skills, search])

  const runAction = async (
    fn: () => Promise<void>,
    okMsg?: string
  ): Promise<boolean> => {
    setError("")
    setNotice("")
    try {
      await fn()
      if (okMsg) setNotice(okMsg)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  const handleCreateSkill = (payload: {
    slug: string
    name: string
    description: string
    reason: string
  }) => {
    return runAction(async () => {
      let created: SkillDetail
      try {
        created = await api<SkillDetail>("/api/skills", {
          method: "POST",
          body: JSON.stringify(payload),
        })
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
        const items = await loadSkills()
        const existing = items.find((item) => item.slug === payload.slug.toLowerCase())
        if (!existing) throw error
        selectSkill(existing.id)
        closeSidebarOnNarrowScreen()
        setShowNewSkill(false)
        setNotice("已打开列表中相同标识的 Skill。")
        return
      }
      setSkills((items) => [created.skill, ...items.filter((item) => item.id !== created.skill.id)])
      selectSkill(created.skill.id, created)
      closeSidebarOnNarrowScreen()
      setShowNewSkill(false)
      setNotice("已创建 Skill。")
    })
  }

  const handleDeleteSkill = (skill: SkillSummary) => {
    void runAction(async () => {
      await api(`/api/skills/${encodeURIComponent(skill.id)}`, {
        method: "DELETE",
      })
      await loadSkills()
    }, "已删除 Skill。")
  }

  const handleAddBlock = (payload: {
    heading: string
    content: string
    reason: string
  }) => {
    if (!detail) return Promise.resolve(false)
    return runAction(async () => {
      await api(`/api/skills/${encodeURIComponent(detail.skill.id)}/blocks`, {
        method: "POST",
        body: JSON.stringify(payload),
      })
      await loadDetail(detail.skill.id)
    }, "已新增段落并记录变更原因。")
  }

  const handleUpdateBlock = (
    blockId: string,
    payload: {
      heading: string
      content: string
      reason: string
    }
  ) => {
    if (!detail) return Promise.resolve(false)
    return runAction(async () => {
      await api(
        `/api/skills/${encodeURIComponent(detail.skill.id)}/blocks/${encodeURIComponent(blockId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        }
      )
      await loadDetail(detail.skill.id)
    }, "已保存段落修改。")
  }

  const handleDeleteBlock = (blockId: string) => {
    if (!detail) return
    openPrompt({
      title: "删除段落",
      placeholder: "请输入删除此段落的原因…",
      confirmLabel: "确认删除",
      destructive: true,
      onConfirm: (reason) => {
        void runAction(async () => {
          await api(
            `/api/skills/${encodeURIComponent(detail.skill.id)}/blocks/${encodeURIComponent(blockId)}`,
            {
              method: "DELETE",
              body: JSON.stringify({ reason }),
            }
          )
          await loadDetail(detail.skill.id)
        }, "已删除段落（历史溯源已保留）。")
      },
    })
  }

  const handleMoveBlock = (index: number, delta: -1 | 1) => {
    if (!detail) return
    const target = index + delta
    if (target < 0 || target >= detail.blocks.length) return
    const next = [...detail.blocks]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    openPrompt({
      title: "调整段落顺序",
      placeholder: "请输入调整顺序的原因…",
      defaultValue: "优化指令执行顺序",
      confirmLabel: "确认调整",
      onConfirm: (reason) => {
        void runAction(async () => {
          await api(
            `/api/skills/${encodeURIComponent(detail.skill.id)}/blocks/reorder`,
            {
              method: "POST",
              body: JSON.stringify({
                orderedBlockIds: next.map((b) => b.id),
                reason,
              }),
            }
          )
          await loadDetail(detail.skill.id)
        }, "已调整段落顺序。")
      },
    })
  }

  const openBlockLineage = (blockId: string) => {
    if (!detail) return
    void runAction(async () => {
      const data = await api<BlockLineage>(
        `/api/skills/${encodeURIComponent(detail.skill.id)}/blocks/${encodeURIComponent(blockId)}/lineage`
      )
      if (selection.current === detail.skill.id) {
        setLineage(data)
        setTab("lineage")
      }
    })
  }

  const handlePublishVersion = () => {
    if (!detail) return
    openPrompt({
      title: `发布 V${detail.skill.currentVersion + 1}`,
      placeholder: "请输入版本发布说明（例如：拆分校验规则并验证通过）",
      confirmLabel: "确认发布",
      onConfirm: (summary) => {
        void runAction(async () => {
          await api(
            `/api/skills/${encodeURIComponent(detail.skill.id)}/versions`,
            {
              method: "POST",
              body: JSON.stringify({ summary }),
            }
          )
          await loadDetail(detail.skill.id)
        }, "已发布新版本快照。")
      },
    })
  }

  const handleSaveAsset = (payload: {
    relPath: string
    content: string
    reason: string
  }) => {
    if (!detail) return Promise.resolve(false)
    return runAction(async () => {
      await api(`/api/skills/${encodeURIComponent(detail.skill.id)}/assets`, {
        method: "POST",
        body: JSON.stringify(payload),
      })
      await loadDetail(detail.skill.id)
    }, "已保存附属文件。")
  }

  const handleDeleteAsset = (relPath: string) => {
    if (!detail) return
    openPrompt({
      title: `删除 ${relPath}`,
      placeholder: "请输入删除原因…",
      defaultValue: "清理不再使用的文件",
      confirmLabel: "确认删除",
      destructive: true,
      onConfirm: (reason) => {
        void runAction(async () => {
          await api(
            `/api/skills/${encodeURIComponent(detail.skill.id)}/assets`,
            {
              method: "DELETE",
              body: JSON.stringify({ relPath, reason }),
            }
          )
          await loadDetail(detail.skill.id)
        }, "已删除附属文件。")
      },
    })
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {sidebarOpen && (
        <SkillSidebar
          skills={filteredSkills}
          selectedId={selectedId}
          search={search}
          loading={loading}
          error={listError}
          onRetry={() => void reloadSkills()}
          onSearch={setSearch}
          onSelect={(id) => {
            selectSkill(id)
            closeSidebarOnNarrowScreen()
          }}
          onClose={() => setSidebarOpen(false)}
          onCreate={() => {
            setError("")
            setShowNewSkill(true)
          }}
          onDelete={setDeleteTarget}
        />
      )}

      <main className={sidebarOpen ? "hidden min-w-0 flex-1 flex-col md:flex" : "flex min-w-0 flex-1 flex-col"}>
        {/* 统一 h-12 顶栏，与左侧栏 h-12 底边严格对齐 */}
        <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"}
            >
              <PanelLeft className="size-4" />
            </Button>
            {detail ? (
              <>
                <h1 className="truncate text-sm font-semibold text-foreground">
                  {detail.skill.name}
                </h1>
                <Badge variant="outline" className="hidden font-mono text-[11px] sm:inline-flex">
                  {detail.skill.slug}
                </Badge>
              </>
            ) : (
              <span className="text-sm font-medium text-muted-foreground">
                Skill 工作台
              </span>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {detail && (
              <>
                <ToggleGroup
                  type="single"
                  value={tab}
                  onValueChange={(value) => {
                    if (value === "blocks" || value === "lineage") {
                      setTab(value)
                    }
                  }}
                  variant="outline"
                  size="sm"
                >
                  <ToggleGroupItem value="blocks" className="h-8 px-2.5 text-xs">
                    段落与文件
                  </ToggleGroupItem>
                  <ToggleGroupItem value="lineage" className="h-8 px-2.5 text-xs">
                    版本与溯源
                  </ToggleGroupItem>
                </ToggleGroup>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => {
                  setError("")
                  setNotice("")
                  setExportTarget(detail)
                }}
                >
                  <FolderOutput className="size-3.5" />
                  导出目录
                </Button>

                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handlePublishVersion}
                >
                  发布 V{detail.skill.currentVersion + 1}
                </Button>
              </>
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
            >
              {theme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <MoonIcon className="size-4" />
              )}
            </Button>
          </div>
        </header>

        {(error || notice) && (
          <div
            className={`flex shrink-0 items-center justify-between border-b px-5 py-2 text-xs ${
              error
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-status-success/30 bg-status-success/10 text-foreground"
            }`}
          >
            <span className="min-w-0 break-all">{error || notice}</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                setError("")
                setNotice("")
              }}
            >
              关闭
            </Button>
          </div>
        )}

        {(!sidebarOpen && listError) || detailError ? (
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs" role="status">
            <span>{listError ? "列表加载失败" : "详情加载失败"} · {listError || detailError}</span>
            <Button type="button" variant="outline" size="xs" onClick={() => {
              if (listError) void reloadSkills()
              else if (selectedId) void loadDetail(selectedId)
            }}>重试</Button>
          </div>
        ) : null}

        {!detail ? (
          <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground" role="status">
            {listError || detailError ? null : loading || selectedId ? "加载中…" : "请选择或新建一个 Skill 开始编排。"}
          </div>
        ) : tab === "blocks" ? (
          <BlocksTab
            detail={detail}
            onAddBlock={handleAddBlock}
            onUpdateBlock={handleUpdateBlock}
            onDeleteBlock={handleDeleteBlock}
            onMoveBlock={handleMoveBlock}
            onOpenLineage={openBlockLineage}
            onSaveAsset={handleSaveAsset}
            onDeleteAsset={handleDeleteAsset}
          />
        ) : (
          <LineageTab
            detail={detail}
            fromVer={fromVersion}
            toVer={toVer}
            compareData={compareData}
            lineage={lineage}
            onFromVerChange={setFromVer}
            onToVerChange={setToVer}
            onOpenLineage={openBlockLineage}
          />
        )}
      </main>

      <CreateSkillDialog
        open={showNewSkill}
        onOpenChange={setShowNewSkill}
        onSubmit={handleCreateSkill}
        error={error}
      />

      {exportTarget && (
        <ExportSkillDialog
          detail={exportTarget}
          onClose={() => setExportTarget(null)}
          onExported={setNotice}
        />
      )}

      <PromptReasonDialog
        key={promptKey}
        config={promptConfig}
        onClose={() => setPromptConfig(null)}
      />

      <ConfirmDeleteSkillDialog
        skillName={deleteTarget?.name ?? null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) handleDeleteSkill(deleteTarget)
        }}
      />
    </div>
  )
}
