export const storySections = [
  { id: "normal", name: "正常流程" },
  { id: "exception", name: "异常流程" },
  { id: "states", name: "不同状态" },
] as const

export type StorySection = (typeof storySections)[number]["id"]

export function readStorySection(value: string | null): StorySection {
  return storySections.find((section) => section.id === value)?.id ?? "normal"
}

export function storySectionName(section: StorySection) {
  return storySections.find((item) => item.id === section)!.name
}
