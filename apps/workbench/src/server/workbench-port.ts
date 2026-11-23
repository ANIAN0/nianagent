export function workbenchPort() {
  const defaultPort =
    process.env.MOON_WORKBENCH_APP === "skills" ? 19832 : 19830
  return Number(
    process.env.PORT ||
      process.env.MOON_WORKBENCH_PORT ||
      process.env.MOON_NOTES_PORT ||
      defaultPort
  )
}
