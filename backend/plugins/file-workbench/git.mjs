import { execFile } from "node:child_process"
import { resolve } from "node:path"
const git = (cwd, args, signal, different = false) =>
  new Promise((accept, reject) => {
    execFile(
      "git",
      ["--no-pager", "--no-optional-locks", ...args],
      {
        cwd,
        signal,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        timeout: 15000,
        encoding: "buffer",
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
      (error, stdout) => {
        if (error && !(different && error.code === 1)) {
          const failure = new Error(
            error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
              ? "Git结果超过当前显示上限，请使用外部Git工具查看。"
              : "Git当前状态无法读取，请确认仓库和Git程序可用后刷新。"
          )
          failure.name = signal?.aborted ? "AbortError" : "Error"
          reject(failure)
        } else {
          try {
            accept(new TextDecoder("utf-8", { fatal: true }).decode(stdout))
          } catch {
            reject(
              new Error(
                "Git结果含非UTF-8内容，当前不能完整显示，请使用外部Git工具查看。"
              )
            )
          }
        }
      }
    )
  })
export async function gitStatus(_input, context, signal) {
  let root
  try {
    root = (
      await git(context.cwd, ["rev-parse", "--show-toplevel"], signal)
    ).trim()
  } catch (error) {
    if (signal?.aborted) throw error
    return { available: false, error: error.message }
  }
  const parts = (
    await git(
      root,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      signal
    )
  ).split("\0")
  const entries = []
  for (let index = 0; index < parts.length; index++) {
    const value = parts[index]
    if (!value) continue
    const status = value.slice(0, 2),
      path = value.slice(3)
    const previous = /[RC]/.test(status) ? parts[++index] : undefined
    const entry = {
      name: path,
      path: resolve(root, path),
      status,
      ...(previous ? { previous } : {}),
    }
    if (status === "??") entries.push({ ...entry, stage: "untracked" })
    else {
      if (status[0] !== " ") entries.push({ ...entry, stage: "staged" })
      if (status[1] !== " ") entries.push({ ...entry, stage: "unstaged" })
    }
  }
  return { available: true, root, entries }
}
export async function gitDiff({ path, stage }, context, signal) {
  const status = await gitStatus({}, context, signal)
  if (!status.available) throw new Error(status.error)
  const item = status.entries.find(
    (item) => item.path === path && item.stage === stage
  )
  if (!item) throw new Error("此项Git状态已变化，请刷新当前仓库。")
  const options = [
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--unified=3",
  ]
  const patch =
    stage === "untracked"
      ? await git(
          status.root,
          ["diff", "--no-index", ...options, "--", "/dev/null", item.path],
          signal,
          true
        )
      : await git(
          status.root,
          [
            "diff",
            ...options,
            ...(stage === "staged" ? ["--cached"] : []),
            "--",
            item.name,
            ...(item.previous ? [item.previous] : []),
          ],
          signal
        )
  return { patch, path: item.path, stage, root: status.root }
}
