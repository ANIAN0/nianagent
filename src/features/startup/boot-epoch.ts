/** 启动时间原点：静态入口脚本（public/startup.js）最先记录；模块缺失时退化为当下。 */
export function bootEpoch(): number {
  const epoch = (window as Window & { moonBootEpoch?: number }).moonBootEpoch
  return typeof epoch === "number" ? epoch : performance.now()
}

/** 距页面原点的毫秒数；启动面用它接续动画相位与阶段披露节奏。 */
export function bootElapsed(): number {
  return performance.now() - bootEpoch()
}

/** 固定阶段名供本地 Performance 面板和验收读取，不包含用户数据。 */
export function markStartup(stage: string) {
  const name = `moon.startup.${stage}`
  if (performance.getEntriesByName(name, "mark").length === 0)
    performance.mark(name)
}
