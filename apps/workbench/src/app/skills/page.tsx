"use client"

import { useEffect } from "react"
import { SkillWorkbench } from "@/skills/skill-workbench"

const THEME_KEY = "moon-notes-theme"

export default function SkillsWorkbenchPage() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"
      document.documentElement.classList.remove("light", "dark")
      document.documentElement.classList.add(saved)
    } catch {
      /* ignore storage errors */
    }
  }, [])

  return <SkillWorkbench />
}
