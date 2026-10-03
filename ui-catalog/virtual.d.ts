declare module "virtual:moon-ui-catalog" {
  const manifest: {
    entries: import("./catalog").CatalogMetadata[]
    dependencies: Record<string, string[]>
  }
  export default manifest
}

declare module "virtual:moon-ui-previews" {
  const paths: Record<string, string>
  export default paths
}
