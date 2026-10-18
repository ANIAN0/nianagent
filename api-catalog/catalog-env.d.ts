declare module "virtual:moon-api-index" {
  export const apiIndex: import("./catalog-data").OperationIndexItem[]
  export const fileApiIndex: import("./catalog-data").FileOperationIndexItem[]
}

declare module "virtual:moon-file-api-docs" {
  export const fileApiDocs: Record<
    string,
    import("./catalog-data").OperationDocumentation & {
      envelope: import("./components/types").OperationDefinition
    }
  >
}

declare module "virtual:moon-api-docs" {
  export const operationDocs: Record<
    import("@/contracts/rpc.generated").ModelOperation,
    () => Promise<import("./catalog-data").OperationDocumentation>
  >
}

declare module "virtual:moon-api-documents" {
  export const apiDocuments: Record<
    string,
    import("./components/types").ApiDocument
  >
}
