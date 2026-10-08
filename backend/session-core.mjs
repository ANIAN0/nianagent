export const names = {
  read: "读取文件",
  write: "写入文件",
  edit: "编辑文件",
  bash: "Bash 命令",
  powershell: "PowerShell 命令",
  grep: "搜索文件内容",
  find: "查找文件",
  ls: "列出目录",
}
export const descriptions = {
  read: "读取文本、图片和指定行范围的文件内容",
  write: "创建文件或写入完整文件内容",
  edit: "按精确文本匹配修改文件中的内容",
  bash: "在工作目录中执行 Bash 命令",
  powershell: "在工作目录中执行 PowerShell 命令",
  grep: "按正则表达式搜索文件内容",
  find: "按文件名或匹配模式查找文件",
  ls: "查看目录中的文件与子目录",
}
export const check = (condition, message) => {
  if (!condition) throw new Error(message)
}
export const extensionSnapshotTools = (snapshot, registered) => {
  const names = new Set(registered.map((tool) => tool.name))
  return (snapshot?.descriptors || []).flatMap((descriptor) =>
    descriptor.tools.filter((tool) => !names.has(tool.id))
  )
}
