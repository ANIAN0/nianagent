import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Choice, ProjectDialog } from "./panel-controls"
import { invoke, type SkillSection, type ResourceDialogProps } from "./service"
export function SkillsDialog({
  projectId,
  pending,
  error,
  run,
  buildPreview,
  disabled,
  data,
}: ResourceDialogProps & { disabled: boolean; data: SkillSection }) {
  const [skills, setSkills] = useState<
    {
      id: string
      slug: string
      name: string
      source: string
      version: number
    }[]
  >()
  const [skillId, setSkillId] = useState("")
  const [location, setLocation] = useState(".agents/skills")
  const [conflicts, setConflicts] = useState<string[]>([])
  const [decisions, setDecisions] = useState<Record<string, string>>({})
  const [mode, setMode] = useState("link")
  async function prepare(change: object) {
    await run(async () => {
      const paths = await buildPreview(change)
      setConflicts(paths)
      if (!paths.length) setSkills(undefined)
    })
  }
  return (
    <>
      <Button
        disabled={pending || disabled}
        variant="outline"
        onClick={() =>
          run(async () => {
            const rows = await invoke<NonNullable<typeof skills>>(
              "listSkills",
              { projectId }
            )
            for (const item of data.items) {
              if (
                item.state === "local" &&
                !rows.some((r) => r.slug === item.name) &&
                /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/.test(item.name)
              ) {
                rows.push({
                  id: "local--" + item.name,
                  slug: item.name,
                  name: item.name + " · 未登记",
                  source: "",
                  version: 0,
                })
              }
            }
            setSkills(rows)
            setDecisions({})
            setConflicts([])
            setSkillId(rows[0]?.id ?? "")
            setMode(rows[0]?.id.startsWith("local--") ? "source" : "link")
          })
        }
      >
        管理项目 Skill
      </Button>
      <ProjectDialog
        open={Boolean(skills)}
        onOpenChange={(v) => {
          if (!v && !pending) setSkills(undefined)
        }}
        title="管理项目 Skill"
      >
        {skills?.length ? (
          <>
            <label>
              库条目{" "}
              <Choice
                label="库条目"
                value={skillId}
                options={skills.map((s) => ({
                  value: s.id,
                  label: s.name + " · v" + s.version,
                }))}
                onChange={(id) => {
                  setSkillId(id)
                  setMode(id.startsWith("local--") ? "source" : "link")
                  setConflicts([])
                  setDecisions({})
                }}
              />
            </label>
            <label>
              安装位置{" "}
              <Choice
                label="安装位置"
                value={location}
                options={[".agents/skills", ".claude/skills"].map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(value) => {
                  setLocation(value)
                  setDecisions({})
                  setConflicts([])
                }}
              />
            </label>
            <label>
              操作{" "}
              <Choice
                label="操作"
                value={mode}
                options={[
                  { value: "link", label: "安装共享链接" },
                  { value: "copy", label: "安装独立副本" },
                  { value: "source", label: "将此项目同名目录登记为共享源" },
                  { value: "publish", label: "发布工作台版本到共享源" },
                  { value: "takeover", label: "接管同名独立目录，保留备份" },
                  { value: "detach", label: "转为独立副本" },
                  { value: "unlink", label: "解除本项目链接" },
                ]}
                onChange={(value) => {
                  setMode(value)
                  setDecisions({})
                  setConflicts([])
                }}
              />
            </label>
            <p className="text-sm break-all">
              {skills.find((s) => s.id === skillId)?.source}
            </p>
            {error && (
              <p role="alert" className="whitespace-pre-wrap">
                {error}
              </p>
            )}
            {conflicts.map((path) => (
              <label key={path}>
                {path}
                <Choice
                  label={path}
                  value={decisions[path] ?? ""}
                  placeholder="选择处理方式"
                  options={[
                    { value: "local", label: "保留本地" },
                    { value: "library", label: "采用工作台版本" },
                  ]}
                  onChange={(value) =>
                    setDecisions({ ...decisions, [path]: value })
                  }
                />
              </label>
            ))}
            <Button
              disabled={pending}
              onClick={() =>
                prepare({
                  kind: "skill.bind",
                  libraryId: skillId,
                  location,
                  mode,
                  decisions,
                })
              }
            >
              预览
            </Button>
          </>
        ) : (
          <p>Skill 库为空，请在 Skill 工作台添加条目。</p>
        )}
      </ProjectDialog>
    </>
  )
}
