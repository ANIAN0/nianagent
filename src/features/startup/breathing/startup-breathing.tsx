import {
  StartupSurface,
  type StartupFailureViewProps,
  type StartupSurfaceProps,
} from "../startup-surface"
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
  return (
    <div className="breathing-startup">
      <StartupSurface
        {...props}
        detailsView={StartupDetailsDialog}
        failureView={BreathingStartupFailure}
      />
    </div>
  )
}
