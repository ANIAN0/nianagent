import "./composer.css"
import { useId, useLayoutEffect, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Pencil,
  Square,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldSet, FieldLegend } from "@/components/ui/field"
import type {
  ConversationQuestion,
  QuestionDraft,
  QuestionAnswer,
  QuestionAnswerDraft,
} from "../conversation-types"

export type QuestionComposerProps = {
  questions: ConversationQuestion[]
  draft?: QuestionDraft
  onDraftChange?: (draft: QuestionDraft) => void
  onAnswer: (answers: QuestionAnswer[]) => void
  onCancel: () => void
  onStop?: () => void
  stopping?: boolean
  busy?: "answer" | "cancel" | null
  error?: string | null
}
const emptyAnswer = (): QuestionAnswerDraft => ({
  selected: [],
  custom: "",
  skipped: false,
})
const answered = (answer: QuestionAnswerDraft) =>
  !!answer.custom.trim() || answer.selected.length > 0
export function QuestionComposer(props: QuestionComposerProps) {
  return props.questions.length ? (
    <QuestionForm
      key={props.questions.map((question) => question.id).join("|")}
      {...props}
    />
  ) : (
    <p role="status">当前没有待回答的问题</p>
  )
}
function QuestionForm({
  questions,
  draft: controlled,
  onDraftChange,
  onAnswer,
  onCancel,
  onStop,
  stopping = false,
  busy = null,
  error,
}: QuestionComposerProps) {
  const [local, setLocal] = useState<QuestionDraft>(() => ({
    index: 0,
    answers: questions.map(emptyAnswer),
    minimized: false,
  }))
  const [feedback, setFeedback] = useState("")
  const state = controlled ?? local
  const index = Math.max(0, Math.min(state.index, questions.length - 1))
  const question = questions[index]
  const titleRef = useRef<HTMLHeadingElement>(null)
  const previousQuestion = useRef(question.id)
  const hasOptions = !!question.options?.length
  useLayoutEffect(() => {
    if (previousQuestion.current !== question.id && hasOptions) {
      titleRef.current?.focus()
    }
    previousQuestion.current = question.id
  }, [question.id, hasOptions])
  const answers = questions.map((_, i) => state.answers[i] ?? emptyAnswer())
  const answer = answers[index]
  const last = index === questions.length - 1
  const locked = !!busy || stopping
  const id = useId()
  function change(patch: Partial<QuestionDraft>) {
    const next = { ...state, ...patch }
    if (!controlled) setLocal(next)
    onDraftChange?.(next)
    setFeedback("")
  }
  function update(value: QuestionAnswerDraft, nextIndex = index) {
    change({
      answers: answers.map((item, i) => (i === index ? value : item)),
      index: nextIndex,
    })
  }
  function choose(label: string) {
    if (locked) return
    if (question.multiSelect)
      update({
        ...answer,
        selected: answer.selected.includes(label)
          ? answer.selected.filter((value) => value !== label)
          : [...answer.selected, label],
        skipped: false,
      })
    else
      update(
        { selected: [label], custom: "", skipped: false },
        last ? index : index + 1
      )
  }
  function submit(values: QuestionAnswerDraft[]) {
    const missing = values.findIndex(
      (value) => !value.skipped && !answered(value)
    )
    if (missing !== -1) {
      change({ index: missing, answers: values })
      setFeedback("请先完成这道问题。")
      return
    }
    onAnswer(
      questions.map((item, i) =>
        values[i].skipped
          ? { id: item.id, selected: [] }
          : {
              id: item.id,
              selected: values[i].selected,
              ...(values[i].custom.trim()
                ? { custom: values[i].custom.trim() }
                : {}),
            }
      )
    )
  }
  function proceed() {
    if (locked) return
    if (!answered(answer) && !answer.skipped) {
      setFeedback("请选择一个选项或填写自定义答案。")
      return
    }
    if (last) submit(answers)
    else change({ index: index + 1 })
  }
  function skip() {
    const next = answers.map((item, i) =>
      i === index ? { ...emptyAnswer(), skipped: true } : item
    )
    change({ answers: next, index: last ? index : index + 1 })
    if (last) submit(next)
  }
  function optionContent(
    label: string,
    description: string | undefined,
    optionIndex: number
  ) {
    const suffix =
      /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
    const selected = answer.selected.includes(label)
    return (
      <>
        <span
          className="question-option-number"
          data-selected={selected}
          aria-hidden="true"
        >
          {optionIndex + 1}
        </span>
        <span className="question-option-copy">
          <span>{label.replace(suffix, "")}</span>
          {suffix.test(label) && <Badge variant="secondary">推荐</Badge>}
          {description && <small>{description}</small>}
        </span>
      </>
    )
  }
  const options = question.options ?? []
  return (
    <section className="conversation-question" aria-labelledby={`${id}-title`}>
      <header>
        <div className="min-w-0">
          {question.header && <p>{question.header}</p>}
          <h2 ref={titleRef} tabIndex={-1} id={`${id}-title`}>
            {question.question}
          </h2>
        </div>
        <div className="flex shrink-0 gap-0.5">
          {onStop && (
            <Button
              variant="ghost"
              size="xs"
              disabled={locked}
              onClick={onStop}
            >
              <Square data-icon="inline-start" />
              {stopping ? "正在停止" : "停止执行"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={state.minimized ? "展开问题卡片" : "收起问题卡片"}
            aria-expanded={!state.minimized}
            disabled={locked}
            onClick={() => change({ minimized: !state.minimized })}
          >
            {state.minimized ? <ChevronUp /> : <ChevronDown />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="放弃整组问题"
            disabled={locked}
            onClick={onCancel}
          >
            <X />
          </Button>
        </div>
      </header>
      {!state.minimized && (
        <>
          <div className="conversation-question-body">
            {question.detail && (
              <p className="question-detail">{question.detail}</p>
            )}
            <FieldGroup>
              <FieldSet>
                <FieldLegend className="sr-only">
                  {question.question}
                </FieldLegend>
                {question.multiSelect ? (
                  <div className="question-options">
                    {options.map((option, i) => (
                      <label
                        key={option.label}
                        className="question-option"
                        data-selected={answer.selected.includes(option.label)}
                      >
                        <Checkbox
                          checked={answer.selected.includes(option.label)}
                          disabled={locked}
                          onCheckedChange={() => choose(option.label)}
                          aria-label={option.label}
                        />
                        <span className="question-option-copy">
                          <span>{option.label}</span>
                          {option.description && (
                            <small>{option.description}</small>
                          )}
                        </span>
                        <span className="sr-only">{i + 1}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <RadioGroup
                    className="question-options"
                    aria-label={question.question}
                    value={answer.selected[0] ?? ""}
                    onValueChange={choose}
                    disabled={locked}
                  >
                    {options.map((option, i) => (
                      <label
                        className="question-option"
                        data-selected={answer.selected.includes(option.label)}
                        key={option.label}
                      >
                        <RadioGroupItem
                          className="question-radio-control"
                          value={option.label}
                          aria-label={option.label}
                        />
                        {optionContent(option.label, option.description, i)}
                      </label>
                    ))}
                  </RadioGroup>
                )}
                <Field
                  orientation="horizontal"
                  className="question-custom"
                  data-filled={!!answer.custom.trim()}
                >
                  {options.length > 0 && <Pencil aria-hidden="true" />}
                  <Textarea
                    key={question.id}
                    autoFocus={!options.length}
                    aria-label="自定义答案"
                    placeholder="输入你的答案"
                    rows={options.length ? 1 : 2}
                    disabled={locked}
                    value={answer.custom}
                    onChange={(event) =>
                      update({
                        selected: question.multiSelect ? answer.selected : [],
                        custom: event.target.value,
                        skipped: false,
                      })
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing &&
                        event.nativeEvent.keyCode !== 229
                      ) {
                        event.preventDefault()
                        proceed()
                      }
                    }}
                  />
                </Field>
              </FieldSet>
            </FieldGroup>
          </div>
          <footer>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="上一题"
                disabled={locked || index === 0}
                onClick={() => change({ index: index - 1 })}
              >
                <ChevronLeft />
              </Button>
              <span className="question-progress">
                {index + 1} / {questions.length}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="下一题"
                disabled={locked || last}
                onClick={() => change({ index: index + 1 })}
              >
                <ChevronRight />
              </Button>
            </div>
            <p role={error ? "alert" : "status"} className="question-feedback">
              {busy === "cancel" ? "正在放弃…" : error || feedback}
            </p>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={locked}
                onClick={skip}
              >
                跳过
              </Button>
              <Button
                size="sm"
                disabled={locked || (!answered(answer) && !answer.skipped)}
                onClick={proceed}
              >
                {busy === "answer" ? "正在提交…" : last ? "提交" : "下一题"}
              </Button>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}
