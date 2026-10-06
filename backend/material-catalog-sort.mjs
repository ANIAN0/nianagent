const normalize = (value) =>
  String(value ?? "")
    .replaceAll("\\", "/")
    .toLowerCase()
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

/** Rank already validated candidates; discovery and the scan budget stay with MaterialService. */
export function sortMaterialCatalogFiles(items, query = "") {
  const search = normalize(query)
  const browsing = !search || search.endsWith("/")
  const rank = (name, path) =>
    browsing
      ? 0
      : name === search
        ? 0
        : name.startsWith(search)
          ? 1
          : name.includes(search)
            ? 2
            : path.includes(search)
              ? 3
              : 4
  return items
    .map((item, index) => {
      const name = normalize(item.name)
      const path = normalize(item.description ?? item.source ?? item.name)
      return { item, index, name, path, rank: rank(name, path) }
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        Number(right.item.type === "directory") -
          Number(left.item.type === "directory") ||
        compare(left.name, right.name) ||
        compare(left.path, right.path) ||
        left.index - right.index
    )
    .map(({ item }) => item)
}
