"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/ui/button"

export default function WorkbenchRootPage() {
  useEffect(() => {
    if (window.location.hash.startsWith("#v2")) {
      window.location.replace(
        `/notes${window.location.search}${window.location.hash}`
      )
    }
  }, [])

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Moon 工作台</h1>
      <nav aria-label="工作台模块" className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          render={<Link href="/notes" prefetch={false} />}
        >
          笔记
        </Button>
        <Button
          variant="outline"
          render={<Link href="/skills" prefetch={false} />}
        >
          Skill
        </Button>
      </nav>
    </main>
  )
}
