/** 仅用于可重建的阅读/展示缓存；草稿与未决回执不得使用容量淘汰。 */
export class BoundedCache<K, V> extends Map<K, V> {
  private maximum: number
  constructor(maximum: number) {
    super()
    this.maximum = maximum
  }
  override get(key: K) {
    const value = super.get(key)
    if (super.has(key)) {
      super.delete(key)
      super.set(key, value!)
    }
    return value
  }
  override set(key: K, value: V) {
    super.delete(key)
    super.set(key, value)
    while (this.size > this.maximum) super.delete(this.keys().next().value!)
    return this
  }
}
