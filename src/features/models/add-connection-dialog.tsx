import { KeyRound, LogIn, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { blankConnection, type ModelConnection } from "./model-types"
import { connectionPresets } from "./connection-presets"
export function AddConnectionDialog({
  open,
  onClose,
  onChoose,
}: {
  open: boolean
  onClose: () => void
  onChoose: (connection: ModelConnection) => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>添加连接</DialogTitle>
          <DialogDescription>选择接入方式，接下来配置连接。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2.5">
          {connectionPresets.map(({ name, endpoint }) => (
            <Button
              key={endpoint}
              variant="outline"
              className="justify-start"
              onClick={() =>
                onChoose({ ...blankConnection("api"), name, endpoint })
              }
            >
              <KeyRound data-icon="inline-start" />
              {name}
            </Button>
          ))}
          <Button
            variant="outline"
            className="h-auto min-h-[66px] justify-start px-4 py-3"
            onClick={() => onChoose(blankConnection("api"))}
          >
            <KeyRound className="size-5" />
            <span className="flex flex-1 flex-col gap-1 text-left">
              自定义 API 连接
              <small className="font-normal text-muted-foreground">
                密钥、环境变量或无凭据服务
              </small>
            </span>
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            className="h-auto min-h-[66px] justify-start px-4 py-3"
            onClick={() => onChoose(blankConnection("subscription"))}
          >
            <LogIn className="size-5" />
            <span className="flex flex-1 flex-col gap-1 text-left">
              订阅账号连接
              <small className="font-normal text-muted-foreground">
                使用 OAuth 登录订阅服务
              </small>
            </span>
            <ChevronRight />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
