/** Canonical key shared by Vite metadata generation and the browser's relative glob maps. */
export function catalogImportPath(projectPath: string): string {
  const path = projectPath.replaceAll("\\", "/")
  return path.startsWith("ui-catalog/")
    ? `./${path.slice("ui-catalog/".length)}`
    : `../${path}`
}
