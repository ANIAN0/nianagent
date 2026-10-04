import { ChevronDown } from "lucide-react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import type { McpTestResult as TestResult } from "./mcp-service"
export type McpTestResultProps = {
  result?: TestResult
  stale?: boolean
  busy?: boolean
  onRetry?: () => void
  demo?: boolean
}
export function McpTestResult({
  result,
  stale,
  busy,
  onRetry,
  demo = false,
}: McpTestResultProps) {
  if (!result) return null
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <OperationFeedback
        title={
          stale
            ? "配置已修改，测试结果已过期"
            : result.state === "connected"
              ? `${demo ? "示例测试通过" : "连接测试通过"} · ${result.tools.length} 个工具`
              : result.state === "needs-auth"
                ? "连接测试需要授权"
                : "连接测试失败"
        }
        message={
          stale
            ? "下面保留上次发现的工具。请使用当前参数重新测试后再确认可用性。"
            : result.state === "connected"
              ? demo
                ? "这是服务替身返回的示例目录，未连接真实 MCP 服务。"
                : "协议和工具目录已验证，测试连接已关闭；会话连接将在发送或应用配置时建立。"
              : result.state === "needs-auth"
                ? "请检查服务凭据或请求头，再重新测试连接。"
                : "请检查服务地址或启动参数，再重新测试连接。"
        }
        details={result.error || undefined}
        severity={
          stale || result.state === "connected"
            ? "info"
            : result.state === "needs-auth"
              ? "warning"
              : "error"
        }
        actions={
          onRetry && (stale || result.state !== "connected") ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onRetry}
            >
              重新测试
            </Button>
          ) : undefined
        }
      />
      <p className="text-xs text-muted-foreground">
        测试时间：{new Date(result.testedAt).toLocaleString()}
      </p>
      {!!result.tools.length && (
        <div className="flex flex-col divide-y">
          {result.tools.map((tool) => (
            <Collapsible key={tool.id} className="py-2">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-between py-3"
                >
                  <span className="flex min-w-0 flex-col items-start gap-1">
                    <span>{tool.name}</span>
                    <span className="text-left text-xs font-normal whitespace-normal text-muted-foreground">
                      {tool.description || "此服务未提供工具说明"}
                    </span>
                  </span>
                  <ChevronDown />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pb-2">
                <p className="mb-2 text-xs break-all text-muted-foreground">
                  {tool.id}
                </p>
                <pre className="max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {tool.inputSchema}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      )}
    </div>
  )
}
