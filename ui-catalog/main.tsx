import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { CatalogPage } from "./catalog-page"
import "@/index.css"
import "./catalog.css"

const theme = new URLSearchParams(location.search).get("theme")
const root = createRoot(document.getElementById("root")!)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
root.render(
  <ThemeProvider
    storageKey={null}
    defaultTheme={theme === "dark" ? "dark" : "light"}
  >
    <CatalogPage />
  </ThemeProvider>
)
