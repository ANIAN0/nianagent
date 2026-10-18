/** Prebuilt, dependency-free entry: the host supplies React and the plugin identity. */
export default function createPlugin(sdk) {
  const h = sdk.React.createElement
  function NoteDelivery({ delivery, deliveries = [delivery] }) {
    return h(
      "div",
      { className: "flex flex-col gap-3" },
      deliveries.map((record, index) => {
        const value = JSON.parse(record.payload)
        return h(
          "article",
          { key: record.originId || index },
          h("h4", { className: "text-sm font-medium" }, value.title),
          h("p", { className: "whitespace-pre-wrap text-sm" }, value.text)
        )
      })
    )
  }
  return {
    id: sdk.pluginId,
    apiVersion: 1,
    deliveries: [{ id: "note", version: 1, component: NoteDelivery }],
  }
}
