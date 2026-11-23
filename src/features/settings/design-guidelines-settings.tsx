import { Card, CardContent } from "@/components/ui/card"

const CORE_GUIDELINES = [
  "同一事实只呈现一次，让布局代替多余的计数与说明。",
  "外观即语义，同级即同形；控件长什么样，就必须是什么。",
  "像素取整、同行等高、边缘齐平，最终以视觉平衡为准。",
]

export function DesignGuidelinesSettings() {
  return (
    <div className="settings-page">
      <div className="settings-page-inner">
        <header>
          <h2>应用开发规范</h2>
        </header>
        <Card>
          <CardContent>
            <ol className="divide-y divide-border">
              {CORE_GUIDELINES.map((rule, index) => (
                <li
                  key={rule}
                  className="flex items-baseline gap-3 py-4 text-sm leading-6 text-foreground first:pt-0 last:pb-0"
                >
                  <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{rule}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
