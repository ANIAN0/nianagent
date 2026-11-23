// @ts-check
// Pi 1.3 ships this SDK bundle beside its public unbundled entry. Resolve
// relative to the same installed package in dev and the packaged runtime.
/** @type {Promise<typeof import("@earendil-works/pi-coding-agent")> | undefined} */
let sdk

/** @returns {Promise<typeof import("@earendil-works/pi-coding-agent")>} */
export function loadPiSdk() {
  return (sdk ??= import(
    new URL(
      "./bundle/index.js",
      import.meta.resolve("@earendil-works/pi-coding-agent")
    ).href
  ))
}
