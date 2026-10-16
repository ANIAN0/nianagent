import { resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"

/** 仅加载正式worker；发行资源验证可以调用，绝不触发迁移或业务服务初始化。 */
export function loadMigrationWorker() {
  return import("./migration-worker.mjs")
}
const messages = {
  runtimeMissing:
    "内置迁移服务文件缺失，当前安装资源不完整，请使用修复后的程序。",
  dependencyMissing:
    "内置迁移服务依赖缺失，当前安装资源不完整，请使用修复后的程序。",
  runtimeIncompatible: "内置迁移运行环境不兼容，请使用修复后的程序。",
  sourceBusy: "旧数据正在使用，请完全退出其他 Moon 后重试。",
  permission: "迁移需要的文件或目录无权访问，请检查源和目标的读写权限。",
  insufficientSpace:
    "目标磁盘空间不足，原数据保留，请更换目标或释放空间后重试。",
  dataInvalid:
    "旧数据或复制结果未通过存储校验，原文件和维护记录保留，请检查存储内容。",
  storageIo:
    "迁移文件未能读取或保存，原文件和维护记录保留，请检查磁盘与文件占用。",
  internal:
    "迁移服务异常退出，原数据和维护记录保留，请打开诊断目录查看失败阶段。",
}
function errorCode(error) {
  for (
    let current = error, count = 0;
    current && count < 5;
    current = current.cause, count++
  )
    if (typeof current.code === "string") return current.code
  return null
}
/** 公共诊断来自受控类型和错误码，不能根据语言猜测JSON/SDK原始异常可以公开。 */
export function migrationFailure(error, stage, worker, record) {
  const primary =
    error instanceof AggregateError && error.cause ? error.cause : error
  const controlled = worker && primary instanceof worker.MigrationError
  const code = controlled
    ? primary.publicCode
    : {
        ERR_MODULE_NOT_FOUND: "dependencyMissing",
        MODULE_NOT_FOUND: "dependencyMissing",
        ERR_DLOPEN_FAILED: "runtimeIncompatible",
        ERR_UNKNOWN_BUILTIN_MODULE: "runtimeIncompatible",
        EACCES: "permission",
        EPERM: "permission",
        ELOCKED: "sourceBusy",
        EBUSY: "sourceBusy",
        ENOSPC: "insufficientSpace",
        ENOENT: stage === "runtime" ? "runtimeMissing" : "storageIo",
        EIO: "storageIo",
      }[errorCode(primary)] ||
      (primary instanceof SyntaxError || stage === "validating"
        ? "dataInvalid"
        : "internal")
  return {
    migrationFailure: true,
    issue: {
      code,
      stage,
      message:
        (controlled ? primary.message : messages[code]) +
        (error instanceof AggregateError
          ? " 同时资源释放或清理未完成，原副本保留。"
          : ""),
      path: record
        ? stage === "runtime"
          ? join(record.installDirectory, "runtime")
          : ["source", "inspecting"].includes(stage)
            ? record.sourceDirectory
            : record.targetDirectory
        : null,
      retryable: ![
        "runtimeMissing",
        "dependencyMissing",
        "runtimeIncompatible",
      ].includes(code),
    },
  }
}
const main =
  process.argv[1] &&
  resolve(process.argv[1]).toLowerCase() ===
    fileURLToPath(import.meta.url).toLowerCase()
if (main) {
  let worker
  let record
  let stage = "runtime"
  try {
    worker = await loadMigrationWorker()
    const [action, recordFile] = process.argv.slice(2)
    if (action === "--probe") console.log(JSON.stringify({ loaded: true }))
    else {
      record = JSON.parse(await readFile(recordFile, "utf8"))
      stage =
        action === "--prepare"
          ? "target"
          : action === "--inspect"
            ? "inspecting"
            : "copying"
      const result = await worker.runMigrationAction(
        action,
        recordFile,
        (value) => {
          if (value.phase === "validating") stage = "validating"
          console.log(JSON.stringify(value))
        }
      )
      console.log(JSON.stringify(result))
    }
  } catch (error) {
    console.error(
      JSON.stringify(migrationFailure(error, stage, worker, record))
    )
    process.exitCode = 1
  }
}
