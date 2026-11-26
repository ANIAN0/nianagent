import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"

export function Choice({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string
  value?: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
const Narrow = createContext(false)
export function ProjectLayout({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null),
    [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width < 880)
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={ref} className="@container p-4">
      <Narrow.Provider value={narrow}>{children}</Narrow.Provider>
    </div>
  )
}
export function ProjectDialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  children: ReactNode
}) {
  const narrow = useContext(Narrow)
  if (narrow)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="overflow-y-auto p-5 data-[side=right]:w-full sm:data-[side=right]:max-w-none">
          <SheetTitle>{title}</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
    )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}
export function useConfirmation() {
  const [question, setQuestion] = useState(""),
    answer = useRef<((accepted: boolean) => void) | undefined>(undefined)
  useEffect(() => () => answer.current?.(false), [])
  function settle(value: boolean) {
    const resolve = answer.current
    answer.current = undefined
    setQuestion("")
    resolve?.(value)
  }
  function confirm(text: string) {
    answer.current?.(false)
    setQuestion(text)
    return new Promise<boolean>((resolve) => {
      answer.current = resolve
    })
  }
  const dialog = (
    <AlertDialog
      open={!!question}
      onOpenChange={(open) => {
        if (!open) settle(false)
      }}
    >
      <AlertDialogContent aria-describedby={undefined}>
        <AlertDialogTitle>{question}</AlertDialogTitle>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)}>
            确认
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { confirm, dialog }
}
