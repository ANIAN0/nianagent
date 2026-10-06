export function sortMaterialCatalogFiles<
  T extends {
    name: string
    type?: string
    description?: string
    source?: string
  },
>(items: readonly T[], query?: string): T[]
