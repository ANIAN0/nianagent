import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "moon 工作台",
  description: "人与 AI 共用的文档、白板、界面审阅与 Skill 工程工作台",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" className="light h-full antialiased" suppressHydrationWarning>
      <body className="flex h-full flex-col">{children}</body>
    </html>
  )
}
