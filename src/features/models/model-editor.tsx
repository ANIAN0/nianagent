import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { SettingsConfirmDialog } from "./settings-confirmation"
import { thinkingLevels, thinkingNames } from "./model-types"
import { modelErrors, type ModelDefinition, type ModelApi } from "./model-types"

export function ModelEditor({
  initial,
  originalId,
  existing,
  connectionName,
  onSave,
  onClose,
}: {
  initial: ModelDefinition
  originalId?: string
  existing: ModelDefinition[]
  connectionName: string
  onSave: (value: ModelDefinition) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [attempted, setAttempted] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const errors = attempted ? modelErrors(draft, existing, originalId) : {}
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft)
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])
  const change = (patch: Partial<ModelDefinition>) =>
    setDraft((value) => ({ ...value, ...patch }))
  const close = () => (dirty ? setConfirm(true) : onClose())
  function submit() {
    setAttempted(true)
    if (Object.keys(modelErrors(draft, existing, originalId)).length) {
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>(
            '[aria-invalid="true"], [data-invalid="true"] button'
          )
          ?.focus()
      )
      return
    }
    onSave({ ...draft, id: draft.id.trim(), name: draft.name.trim() })
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent className="model-dialog sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>
              {originalId ? "编辑模型" : "手工添加模型"}
            </DialogTitle>
            <DialogDescription>
              {connectionName || "新连接"} · 修改先加入草稿，保存连接后生效。
            </DialogDescription>
          </DialogHeader>
          <form
            ref={form}
            id="model-definition-form"
            className="model-dialog-scroll"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <FieldGroup className="gap-4">
              <Field data-invalid={!!errors.id}>
                <FieldLabel htmlFor="model-id">模型 ID</FieldLabel>
                <Input
                  id="model-id"
                  autoFocus
                  value={draft.id}
                  aria-invalid={!!errors.id}
                  onChange={(e) => change({ id: e.target.value })}
                />
                {errors.id ? (
                  <FieldError>{errors.id}</FieldError>
                ) : (
                  <FieldDescription>
                    服务请求使用的标识，例如 gpt-4.1。
                  </FieldDescription>
                )}
              </Field>
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="model-name">显示名称</FieldLabel>
                <Input
                  id="model-name"
                  value={draft.name}
                  aria-invalid={!!errors.name}
                  onChange={(e) => change({ name: e.target.value })}
                />
                {errors.name && <FieldError>{errors.name}</FieldError>}
              </Field>
              <Field data-invalid={!!errors.api}>
                <FieldLabel>接口方式</FieldLabel>
                <Select
                  value={draft.api}
                  onValueChange={(value) => change({ api: value as ModelApi })}
                >
                  <SelectTrigger
                    aria-label="模型接口方式"
                    aria-invalid={!!errors.api}
                    className="w-full"
                  >
                    <SelectValue placeholder="选择接口" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="openai-responses">
                        OpenAI Responses
                      </SelectItem>
                      <SelectItem value="openai-completions">
                        Chat Completions
                      </SelectItem>
                      <SelectItem value="anthropic-messages">
                        Anthropic Messages
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {errors.api && <FieldError>{errors.api}</FieldError>}
              </Field>
              <FieldSet data-invalid={!!errors.reasoning}>
                <FieldLegend variant="label">思考能力</FieldLegend>
                <RadioGroup
                  aria-label="思考能力"
                  aria-invalid={!!errors.reasoning}
                  className="model-radio"
                  value={
                    draft.reasoning === undefined
                      ? ""
                      : draft.reasoning
                        ? "yes"
                        : "no"
                  }
                  onValueChange={(value) =>
                    change({ reasoning: value === "yes" })
                  }
                >
                  <label>
                    <RadioGroupItem value="yes" />
                    支持思考
                  </label>
                  <label>
                    <RadioGroupItem value="no" />
                    不支持思考
                  </label>
                </RadioGroup>
                {errors.reasoning && (
                  <FieldError>{errors.reasoning}</FieldError>
                )}
              </FieldSet>
              {draft.reasoning && (
                <FieldSet>
                  <FieldLegend variant="label">支持的思考等级</FieldLegend>
                  <div className="flex flex-wrap gap-3">
                    {(
                      Object.keys(
                        thinkingNames
                      ) as (keyof typeof thinkingNames)[]
                    ).map((level) => (
                      <label key={level} className="flex items-center gap-2">
                        <Checkbox
                          checked={thinkingLevels(draft).includes(level)}
                          onCheckedChange={(checked) =>
                            change({
                              thinkingLevelMap: {
                                ...draft.thinkingLevelMap,
                                [level]: checked ? level : null,
                              },
                            })
                          }
                        />
                        {thinkingNames[level]}
                      </label>
                    ))}
                  </div>
                  <FieldDescription>
                    来自 Pi 的参考能力；可按当前服务实际支持范围调整。
                  </FieldDescription>
                </FieldSet>
              )}
              <FieldSet data-invalid={!!errors.input}>
                <FieldLegend variant="label">输入能力</FieldLegend>
                <div className="model-radio">
                  {(["text", "image"] as const).map((kind) => (
                    <label key={kind}>
                      <Checkbox
                        checked={draft.input.includes(kind)}
                        onCheckedChange={(checked) =>
                          change({
                            input: checked
                              ? [...draft.input, kind]
                              : draft.input.filter((value) => value !== kind),
                          })
                        }
                      />
                      {kind === "text" ? "文本" : "图像"}
                    </label>
                  ))}
                </div>
                {errors.input && <FieldError>{errors.input}</FieldError>}
              </FieldSet>
              <FieldGroup className="model-field-grid">
                {(
                  [
                    ["contextWindow", "上下文上限（tokens）"],
                    ["maxTokens", "最大输出（tokens）"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} data-invalid={!!errors[key]}>
                    <FieldLabel htmlFor={`model-${key}`}>{label}</FieldLabel>
                    <Input
                      id={`model-${key}`}
                      type="number"
                      min={1}
                      step={1}
                      value={draft[key] ?? ""}
                      aria-invalid={!!errors[key]}
                      onChange={(e) =>
                        change({
                          [key]: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                    />
                    {errors[key] && <FieldError>{errors[key]}</FieldError>}
                  </Field>
                ))}
              </FieldGroup>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              取消
            </Button>
            <Button
              type="submit"
              form="model-definition-form"
              disabled={!dirty}
            >
              加入连接草稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SettingsConfirmDialog
        value={
          confirm
            ? {
                title: "放弃模型修改？",
                description: "当前模型尚未加入连接草稿。",
                label: "放弃更改",
                destructive: true,
                action: onClose,
              }
            : undefined
        }
        onCancel={() => setConfirm(false)}
        onConfirm={onClose}
      />
    </>
  )
}
