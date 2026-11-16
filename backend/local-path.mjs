// @ts-check
// UNC/设备路径在 Windows 上于 realpath/open 阶段会向远端主机发起 SMB 认证并
// 泄漏本机凭据；文件入口统一在此拒绝。单反斜杠与正斜杠开头的根相对路径
// （\foo、/foo）是本机当前盘符路径，不属于网络路径，照常放行。
export function assertLocalPath(value, label = "路径") {
  if (typeof value !== "string" || !value) return
  // `//`、`\\` 开头：UNC 共享或 `\\?\`、`\\.\` 设备命名空间。
  // `\??\` 开头：NT 对象管理器路径，可直达设备与 UNC 重定向。
  if (/^[/\\]{2}/.test(value) || /^\\+\?\?\\/.test(value))
    throw new Error(`${label}不接受网络或设备路径。`)
}
