/** 缩短 workflow//ns//Name 为可读短名（对齐上游 parseWorkflowName.shortName）。 */
export function shortWorkflowName(name: string | undefined | null): string {
  if (!name) return "—";
  const parts = name.split("//").filter(Boolean);
  return parts[parts.length - 1] || name;
}
