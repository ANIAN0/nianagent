import { createHighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

const grammars = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  bash: () => import("shiki/langs/shellscript.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
} as const

type Language = keyof typeof grammars
type Token = { content: string; light?: string; dark?: string }
const aliases: Record<string, Language> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  ps1: "powershell",
  yml: "yaml",
}
const registrations = new Map<Language, Promise<void>>()
let highlighter: ReturnType<typeof createHighlighterCore> | undefined

export async function highlightMessage(
  source: string,
  rawLanguage: string
): Promise<Token[][] | undefined> {
  const key = rawLanguage.toLowerCase()
  const language =
    aliases[key] ??
    (Object.hasOwn(grammars, key) ? (key as Language) : undefined)
  if (!language) return
  const core = await (highlighter ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    langs: [],
    themes: [
      import("shiki/themes/github-light.mjs"),
      import("shiki/themes/github-dark.mjs"),
    ],
  }))
  let registration = registrations.get(language)
  if (!registration) {
    registration = grammars[language]().then((grammar) =>
      core.loadLanguage(grammar.default)
    )
    registrations.set(language, registration)
  }
  await registration
  return core
    .codeToTokensWithThemes(source, {
      lang: language,
      themes: { light: "github-light", dark: "github-dark" },
    })
    .map((line) =>
      line.map(({ content, variants }) => ({
        content,
        light: variants.light?.color,
        dark: variants.dark?.color,
      }))
    )
}
