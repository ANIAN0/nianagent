export function workbenchPort() {
  return Number(
    process.env.PORT ||
      process.env.MOON_WORKBENCH_PORT ||
      process.env.MOON_NOTES_PORT ||
      19830
  )
}
