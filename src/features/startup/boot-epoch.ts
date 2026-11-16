/** 启动时间原点：静态入口脚本（public/startup.js）最先记录；模块缺失时退化为当下。 */
export function bootEpoch(): number {
  const epoch = (window as Window & { moonBootEpoch?: number }).moonBootEpoch
  return typeof epoch === "number" ? epoch : performance.now()
}

/** 距页面原点的毫秒数；启动面用它接续动画相位与阶段披露节奏。 */
export function bootElapsed(): number {
  return performance.now() - bootEpoch()
}
