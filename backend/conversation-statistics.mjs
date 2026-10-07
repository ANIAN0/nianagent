export function runStatisticsEvent(state, event) {
  if (!state.runMetrics) return
  if (event.type === "message_start" && event.message.role === "assistant")
    state.runMetrics.messageStartedAt = performance.now()
  if (event.type === "message_end" && event.message.role === "assistant") {
    if (state.runMetrics.messageStartedAt !== undefined)
      state.runMetrics.modelDurationMs +=
        performance.now() - state.runMetrics.messageStartedAt
    delete state.runMetrics.messageStartedAt
    const output = event.message.usage?.output
    if (Number.isFinite(output) && output > 0) {
      state.runMetrics.outputTokens += output
      state.runMetrics.hasUsage = true
    }
  }
}
export function conversationStatistics(state) {
  const totals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    toolCalls: 0,
    turns: 0,
    steps: 0,
  }
  let cost = 0
  let sawUser = false
  let turnHasAssistant = false
  for (const entry of state.manager.getBranch()) {
    if (entry.type !== "message") continue
    if (entry.message.role === "user") {
      sawUser = true
      turnHasAssistant = false
    }
    if (entry.message.role !== "assistant") continue
    totals.steps += 1
    // A turn is a user round answered by an assistant; an assistant-led
    // branch without a preceding user message must not count as a round.
    if (sawUser && !turnHasAssistant) {
      totals.turns += 1
      turnHasAssistant = true
    }
    const message = entry.message,
      usage = message.usage
    totals.toolCalls += (message.content || []).filter(
      (item) => item.type === "toolCall"
    ).length
    if (usage) {
      for (const key of ["input", "output", "cacheRead", "cacheWrite"])
        totals[key] += Math.max(0, usage[key] || 0)
      cost += Math.max(0, usage.cost?.total || 0)
    }
  }
  totals.totalTokens =
    totals.input + totals.output + totals.cacheRead + totals.cacheWrite
  // Zero rates on user-defined models mean unknown price, not a free bill.
  if (cost > 0) totals.cost = cost
  const metrics = state.runMetrics
  if (metrics) {
    totals.durationMs = Math.round(
      metrics.durationMs ?? performance.now() - metrics.startedAt
    )
    totals.modelDurationMs = Math.round(
      metrics.modelDurationMs +
        (metrics.messageStartedAt !== undefined
          ? performance.now() - metrics.messageStartedAt
          : 0)
    )
    if (metrics.hasUsage) totals.outputTokens = metrics.outputTokens
    if (metrics.hasUsage && metrics.modelDurationMs > 0)
      totals.tokensPerSecond =
        metrics.outputTokens / (metrics.modelDurationMs / 1000)
  } else if (state.recoveredStatistics)
    Object.assign(totals, state.recoveredStatistics, {
      ...totals,
      restored: true,
    })
  return totals
}
