declare module "virtual:moon-api-index" {
  export const apiIndex: import("./catalog-data").OperationIndexItem[]
}

declare module "virtual:moon-api-docs" {
  export const operationDocs: Record<
    import("@/contracts/rpc.generated").ModelOperation,
    () => Promise<import("./catalog-data").OperationDocumentation>
  >
}
