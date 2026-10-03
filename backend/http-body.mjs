// Decode once after collecting bytes: network chunks may split UTF-8 characters.
export async function readJsonBody(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 1024 * 1024) throw new Error("请求过大。")
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"))
}
