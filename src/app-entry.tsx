import App from "./App"
import { ComposerToaster } from "@/components/composer/composer-notification"

/** BootApp完成服务/profile/模块确认后才挂载此业务入口。 */
export default function AppEntry() {
  return (
    <>
      <App />
      <ComposerToaster />
    </>
  )
}
