import { AlertCircle, CheckCircle2, ChevronDown, KeyRound } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import type { McpTestResult as TestResult } from "./mcp-service"
export type McpTestResultProps = { result?: TestResult; stale?: boolean }
export function McpTestResult({ result, stale }: McpTestResultProps) {
  if (!result) return null
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <Alert variant={result.state === "failed" ? "destructive" : "default"}>
        {result.state === "connected" ? (
          <CheckCircle2 />
        ) : result.state === "needs-auth" ? (
          <KeyRound />
        ) : (
          <AlertCircle />
        )}
        <AlertTitle>
          {stale
            ? "参数已修改，请重新测试"
            : result.state === "connected"
              ? `连接测试通过 · ${result.tools.length} 个工具`
              : result.state === "needs-auth"
                ? "服务需要授权"
                : "连接测试失败"}
        </AlertTitle>
        <AlertDescription>
          {result.error || "已验证协议和工具目录，测试连接已关闭。"}{" "}
          {new Date(result.testedAt).toLocaleString()}
        </AlertDescription>
      </Alert>
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
