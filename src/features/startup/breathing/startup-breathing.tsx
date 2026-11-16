import { useMemo, type CSSProperties } from "react"
import {
  StartupSurface,
  type StartupFailureViewProps,
  type StartupSurfaceProps,
} from "../startup-surface"
import { bootElapsed } from "../boot-epoch"
import { StartupDetailsDialog } from "./startup-details-dialog"
import "./startup-breathing.css"

function BreathingStartupFailure({ title, pending }: StartupFailureViewProps) {
  const retrying = pending === "retry"
  return (
    <div className="startup-failure" data-retrying={retrying} role="status">
      <h2 key={retrying ? "retry" : title}>{retrying ? "正在重试…" : title}</h2>
    </div>
  )
}

/** 独立的组件库设计方案；启动状态与恢复行为仍由原组件负责。 */
export function BreathingStartupSurface(props: StartupSurfaceProps) {
  // 相位锁：全部启动面实例共享页面原点，交接时月体与柔光呼吸不回卷。
  const phaseStyle = useMemo<CSSProperties>(
    () =>
      ({ "--boot-phase": `${(-bootElapsed()).toFixed(0)}ms` }) as CSSProperties,
    []
  )
  return (
    <div className="breathing-startup" style={phaseStyle}>
      <StartupSurface
        {...props}
        detailsView={StartupDetailsDialog}
        failureView={BreathingStartupFailure}
      />
    </div>
  )
}
