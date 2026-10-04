import { useEffect, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { loadArchitecture } from "./catalog-data"
import { ArchitectureViewer } from "./components/architecture-viewer"

export default function ArchitecturePanel({ module }: { module: string }) {
  const [content, setContent] = useState("")
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let mounted = true
    void loadArchitecture().then(
      (text) => {
        if (mounted) {
          setContent(text)
          setError("")
        }
      },
      (cause: unknown) => {
        if (mounted)
          setError(
            cause instanceof Error ? cause.message : "架构说明载入失败。"
          )
      }
    )
    return () => {
      mounted = false
    }
  }, [revision])
  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>无法载入架构说明</AlertTitle>
        <AlertDescription>
          {error}
          <Button
            variant="outline"
            onClick={() => {
              setError("")
              setRevision((old) => old + 1)
            }}
          >
            重新载入
          </Button>
        </AlertDescription>
      </Alert>
    )
  if (!content)
    return (
      <div
        role="status"
        aria-label="载入架构说明"
        className="flex flex-col gap-4"
      >
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  const chapter: Record<string, string> = {
    模型配置: "模型配置模块",
    工作区: "工作区模块",
    会话列表: "会话目录与 Pi 多轮对话",
    真实对话: "会话目录与 Pi 多轮对话",
    会话配置: "会话配置模块",
    "MCP 服务": "MCP 服务模块",
    运行中消息: "待处理消息与草稿",
    消息材料: "消息材料",
    上下文压缩: "会话控制",
    会话派生: "会话控制",
    本地扩展: "公开扩展边界",
    操作回执: "配置写入回执",
  }
  return (
    <ArchitectureViewer
      content={content}
      module={module}
      sectionTitle={chapter[module]}
      focusOnMount
    />
  )
}
