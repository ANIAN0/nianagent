/** 尽力关闭全部资源，同时在维护路径保留每个失败，避免误报安全退出。 */
export async function settleResources(promises, strict = false) {
  const results = await Promise.allSettled(promises)
  const failures = results.filter((result) => result.status === "rejected")
  if (strict && failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      "部分资源关闭未完成，请重启 Moon 恢复。"
    )
  return results
}
