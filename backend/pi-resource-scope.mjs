// @ts-check
/** @typedef {{transports:Set<{close:()=>unknown}>,extensionClosers:Set<()=>unknown>,disposed:boolean,generation:number,closing?:Promise<void>}} PiResourceScope */
/** 每一代 SDK 资源成对释放；尚未初始化完的 transport 也属于宿主。 */
/** @param {PiResourceScope} resources */
export async function closePiResources(resources) {
  const closers = [
    ...[...resources.transports].map((transport) => () => transport.close()),
    ...resources.extensionClosers,
  ]
  await Promise.allSettled(
    closers.map((close) => Promise.resolve().then(close))
  )
}

/** @param {import("@earendil-works/pi-coding-agent").AgentSession} session
 * @param {PiResourceScope} resources
 * @param {{isClosed:()=>boolean, unregister:()=>void, ownClosing:(closing:Promise<void>)=>void}} ports */
export function bindPiResourceScope(
  session,
  resources,
  { isClosed, unregister, ownClosing }
) {
  const dispose = session.dispose.bind(session)
  session.dispose = () => {
    if (resources.disposed) return
    resources.disposed = true
    resources.generation++
    try {
      unregister()
      dispose()
    } finally {
      resources.closing = closePiResources(resources)
      ownClosing(resources.closing)
    }
  }
  const reload = session.reload.bind(session)
  session.reload = async (options) => {
    if (resources.disposed || isClosed())
      throw new Error("会话已关闭，不能重载资源。")
    resources.generation++
    await closePiResources(resources)
    if (resources.disposed || isClosed())
      throw new Error("会话已关闭，不能重载资源。")
    await reload(options)
  }
}
