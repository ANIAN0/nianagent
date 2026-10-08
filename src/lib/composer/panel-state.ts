/** A late close only releases the panel that still owns the composer. */
export function nextComposerPanel(
  current: string | null,
  owner: string,
  open: boolean
): string | null {
  return open ? owner : current === owner ? null : current
}
