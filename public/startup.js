/* global window, document, navigator, HTMLScriptElement */
// 入口脚本自身失效时不能依赖同一模块显示错误，也不公开原始异常。
// 页面时间原点：静态页、React 启动面据此接续呼吸相位，交接不回卷动画。
window.moonBootEpoch = performance.now()
window.moonInitialBootState = { deadline: Date.now() + 30000, failed: false }
const moonInitialStage = document.getElementById("moon-initial-stage")
// 快启动保持安静：超过1.5秒仍没就绪才显示阶段文本。
window.setTimeout(function () {
  if (!window.moonInitialBootState.failed && moonInitialStage)
    moonInitialStage.hidden = false
}, 1500)
// G08：自动恢复分类——仅"入口脚本加载失败"属于可重试的资源暂态（如依赖重优化），
// 触发一次有界重载并记录原因/次数；超时路径不自动重载，直接进入恢复页。
window.moonInitialBootFailure = function (kind) {
  const surface = document.getElementById("moon-initial-boot")
  if (!surface) return
  var reason = kind === "script-error" ? "入口脚本加载失败" : "界面加载超时"
  if (kind === "script-error") {
    try {
      var attempts = Number(window.sessionStorage.getItem("moon-boot-reload") || "0")
      if (attempts < 1) {
        window.sessionStorage.setItem("moon-boot-reload", String(attempts + 1))
        console.warn("[moon-boot] 入口脚本加载失败，执行一次有界重载（第 " + (attempts + 1) + " 次）")
        window.location.reload()
        return
      }
      console.warn("[moon-boot] 重载后仍失败，进入恢复页")
    } catch (error) {
      /* 存储不可用时直接显示失败。 */
    }
  } else {
    console.warn("[moon-boot] " + reason + "，等待用户手动恢复")
  }
  window.moonInitialBootState.failed = true
  surface.dataset.status = "failed"
  const dot = document.getElementById("moon-initial-dot")
  if (dot) dot.remove()
  const stage = document.getElementById("moon-initial-stage-text")
  const actions = document.getElementById("moon-initial-actions")
  if (moonInitialStage) moonInitialStage.hidden = false
  if (stage) stage.textContent = "界面加载超时，请重新加载。"
  if (actions) actions.hidden = false
}
document
  .getElementById("moon-initial-retry")
  .addEventListener("click", function () {
    window.location.reload()
  })
document
  .getElementById("moon-initial-copy")
  .addEventListener("click", function () {
    const button = this
    button.disabled = true
    Promise.resolve()
      .then(function () {
        return navigator.clipboard.writeText(
          "Moon 启动诊断\n阶段：加载启动界面\n原因：入口或依赖资源未能加载，或等待超过30秒。"
        )
      })
      .then(function () {
        button.textContent = "诊断已复制"
      })
      .catch(function () {
        button.textContent = "复制失败，再试一次"
      })
      .finally(function () {
        button.disabled = false
      })
  })
window.setTimeout(function () {
  window.moonInitialBootFailure("timeout")
}, 30000)
window.addEventListener(
  "error",
  function (event) {
    if (
      event.target instanceof HTMLScriptElement &&
      event.target.id === "moon-main-module"
    )
      window.moonInitialBootFailure("script-error")
  },
  true
)
