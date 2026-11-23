import { NextResponse } from "next/server"

export function isVersionId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
  )
}

export function previewError(status: number, code: string, error: string) {
  return NextResponse.json({ error, code }, { status })
}

export function previewFailure(error: unknown) {
  const code =
    error instanceof Error && "code" in error ? error.code : undefined
  switch (code) {
    case "validation_failed":
    case "unsupported_artifact":
      return previewError(400, code, (error as Error).message)
    case "not_found":
      return previewError(404, code, "版本不存在。")
    case "limit_exceeded":
      return previewError(503, code, (error as Error).message)
    default:
      return previewError(500, "internal_error", "预览请求失败，请重试。")
  }
}
