/* global window, document, navigator, HTMLScriptElement */
// 入口脚本自身失效时不能依赖同一模块显示错误，也不公开原始异常。
window.moonInitialBootState = { deadline: Date.now() + 30000, failed: false }
window.moonInitialBootFailure = function () {
  if (!document.getElementById("moon-initial-boot")) return
  window.moonInitialBootState.failed = true
  const stage = document.getElementById("moon-initial-stage")
  const actions = document.getElementById("moon-initial-actions")
  if (stage) stage.textContent = "启动界面加载失败，请重新加载。"
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
window.setTimeout(window.moonInitialBootFailure, 30000)
window.addEventListener(
  "error",
  function (event) {
    if (
      event.target instanceof HTMLScriptElement &&
      event.target.id === "moon-main-module"
    )
      window.moonInitialBootFailure()
  },
  true
)
