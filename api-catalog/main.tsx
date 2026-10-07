import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { NotificationToaster } from "@/components/ui/notification-toast"
import { ApiCatalogApp } from "./app"
import "@/index.css"
import "./catalog.css"

const root = createRoot(document.getElementById("root")!)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
root.render(
  <ThemeProvider storageKey={null} defaultTheme="light">
    <ApiCatalogApp />
    <NotificationToaster />
  </ThemeProvider>
)
