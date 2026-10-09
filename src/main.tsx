import { StartupRecovery } from "@/features/settings/startup-recovery"
import { TooltipProvider } from "@/components/ui/tooltip"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ComposerToaster } from "@/components/composer/composer-notification"
import { ThemeProvider } from "@/components/theme-provider.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <StartupRecovery>
          <App />
        </StartupRecovery>
        <ComposerToaster />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
)
