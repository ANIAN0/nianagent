import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

export async function saveDownload(body, target, signal) {
  await mkdir(dirname(target), { recursive: true })
  const stream = createWriteStream(target)
  await pipeline(Readable.fromWeb(body), stream, { signal })
  return stream.bytesWritten
}
