/** 名称解析（对齐 @workflow/utils/parse-name 的 shortName 语义）。 */

export function shortName(full: string | undefined | null): string {
  if (!full) return "?";
  // workflow//ns//Name 或 path#export
  if (full.includes("//")) {
    const parts = full.split("//").filter(Boolean);
    return parts[parts.length - 1] || full;
  }
  if (full.includes("#")) {
    const hash = full.split("#").pop();
    if (hash) return hash;
  }
  if (full.includes("/")) {
    const base = full.split("/").pop();
    if (base) return base;
  }
  return full;
}
