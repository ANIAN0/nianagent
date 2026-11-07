import { ConversationIdleInputExample } from "./conversation-idle-input-stories.tsx"
import type { IdleInputScenario } from "./conversation-idle-input-service.ts"

export type RunningMessageScenario = Extract<
  IdleInputScenario,
  `running-${string}`
>

/** Uses the formal conversation view and hook; only the service port is isolated. */
export function RunningMessageStoryExample({
  scenario = "running-normal",
}: {
  scenario?: RunningMessageScenario
}) {
  return <ConversationIdleInputExample scenario={scenario} />
}
