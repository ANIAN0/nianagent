const noPending = Object.freeze({ approvals: 0, answers: 0 })

function conversationSummary(record, projection) {
  if (!record) return null
  const {
    sessionFile: _sessionFile,
    lastRequestId: _lastRequestId,
    lastRequestFingerprint: _lastRequestFingerprint,
    ...summary
  } = record
  return {
    ...summary,
    pending:
      record.status !== "stopping" && projection?.runId === record.runId
        ? projection.counts
        : noPending,
  }
}

// Uses the same store instance as the Pi runner; no transcript or workspace
// file is read directly by this module.
export class ConversationCatalogService {
  constructor(store, pendingBySession) {
    this.store = store
    this.pendingBySession = pendingBySession
  }
  summarize(record) {
    return conversationSummary(record, this.pendingBySession().get(record?.id))
  }
  async list(filter = {}, signal) {
    const records = await this.store.list(filter, signal)
    const pending = this.pendingBySession()
    return records.map((record) =>
      conversationSummary(record, pending.get(record.id))
    )
  }
  async info(id, signal) {
    return this.summarize(await this.store.get(id, signal))
  }
  async markRead(id, revision, signal) {
    return this.summarize(await this.store.markRead(id, revision, signal))
  }
  async rename(id, title, signal) {
    return this.summarize(await this.store.rename(id, title, signal))
  }
  async setPinned(id, pinned, signal) {
    return this.summarize(await this.store.setPinned(id, pinned, signal))
  }
  async setArchived(id, archived, signal, expectedRunId) {
    const record = await this.store.setArchived(id, archived, signal, {
      expectedRunId,
      hasPending: (record) => {
        const pending = this.pendingBySession().get(record.id)
        return (
          pending?.runId === record.runId &&
          !!pending &&
          (pending.counts.approvals > 0 || pending.counts.answers > 0)
        )
      },
    })
    return this.summarize(record)
  }
}
