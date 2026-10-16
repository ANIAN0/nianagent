/** Only the current local application and approved remote entry are supported.
 * @param {string} base
 */
export function assertWebBase(base) {
  if (base !== "/" && base !== "/moon/")
    throw new Error("Moon页面仅支持 / 或 /moon/ 前缀，请核对 MOON_WEB_BASE 或 --base。")
  return base
}
