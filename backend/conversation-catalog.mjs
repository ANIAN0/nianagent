export function conversationSummary(record) {
  if (!record) return null
  const {
    sessionFile: _sessionFile,
    lastRequestId: _lastRequestId,
    lastRequestFingerprint: _lastRequestFingerprint,
    ...summary
  } = record
  return summary
}

// Uses the same store instance as the Pi runner; no transcript or workspace
// file is read directly by this module.
export class ConversationCatalogService {
  constructor(store) {
    this.store = store
  }
  async list(filter = {}, signal) {
    return (await this.store.list(filter, signal)).map(conversationSummary)
  }
  async info(id, signal) {
    return conversationSummary(await this.store.get(id, signal))
  }
  async markRead(id, revision, signal) {
    return conversationSummary(await this.store.markRead(id, revision, signal))
  }
}
