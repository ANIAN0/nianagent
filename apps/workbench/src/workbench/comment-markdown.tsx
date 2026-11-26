"use client"

import { useMemo } from "react"
import { Marked } from "marked"
import { cn } from "cn"

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

/** 评论 URL 净化：仅允许 http/https/mailto、data:image 与相对路径，拒绝控制字符与脚本协议。 */
export function safeCommentUrl(url: string | null | undefined, image = false) {
  const raw = String(url ?? "").trim()
  if (!raw) return null
  if (
    [...raw].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    )
  )
    return null
  if (/^https?:\/\//i.test(raw)) return raw
  if (/^mailto:/i.test(raw)) return image ? null : raw
  if (/^data:image\//i.test(raw)) return image ? raw : null
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  return raw
}

const commentMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html(token) {
      return escapeHtml(token.text ?? token.raw ?? "")
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens ?? [])
      const href = safeCommentUrl(token.href)
      if (href === null) return `<a>${text}</a>`
      const external = /^https?:\/\//i.test(href)
      return external
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
        : `<a href="${escapeHtml(href)}">${text}</a>`
    },
    image(token) {
      const alt = escapeHtml(token.text ?? "")
      const src = safeCommentUrl(token.href, true)
      if (src === null) return alt
      return `<img src="${escapeHtml(src)}" alt="${alt}">`
    },
  },
})

export function renderCommentMarkdown(markdown: string): string {
  return String(commentMarked.parse(String(markdown ?? "")))
}

export function CommentMarkdown({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  const html = useMemo(() => renderCommentMarkdown(content), [content])
  return (
    <div
      className={cn("v2-comment-md text-sm leading-relaxed", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
