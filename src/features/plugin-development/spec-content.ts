import source from "./plugin-spec.md?raw"
import api from "../plugins/plugin-api.ts?raw"
import examplePackage from "../../../backend/plugins/example-note/package.json?raw"
import exampleWeb from "../../../backend/plugins/example-note/web.mjs?raw"
import examplePi from "../../../backend/plugins/example-note/pi.mjs?raw"
import appApi from "../../../backend/plugin-app.d.mts?raw"

const document = source
  .replace("<!-- moon-app-api -->", "```typescript\n" + appApi + "\n```")
  .replace("<!-- moon-public-api -->", "```typescript\n" + api + "\n```")
  .replace(
    "<!-- moon-example-package -->",
    "```json\n" + examplePackage + "\n```"
  )
  .replace(
    "<!-- moon-example-web -->",
    "```javascript\n" + exampleWeb + "\n```"
  )
  .replace("<!-- moon-example-pi -->", "```javascript\n" + examplePi + "\n```")

/** The published page and its navigation are projections of one maintained document. */
export const pluginSpecSections = document
  .split(/^## /m)
  .slice(1)
  .map((part) => {
    const lineEnd = part.indexOf("\n")
    const title = part.slice(0, lineEnd).trim()
    return { id: title, title, body: part.slice(lineEnd + 1).trim() }
  })
