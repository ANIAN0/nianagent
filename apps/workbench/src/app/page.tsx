import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default function WorkbenchRootPage() {
  if (process.env.MOON_WORKBENCH_APP === "skills") {
    redirect("/skills")
  }
  redirect("/notes")
}
