import { useState } from "react"
import { Folder, ChevronDown, Check, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { DirectoryPicker } from "./directory-picker"
import type { Workspace } from "./home-types"
export type WorkspacePickerProps = {
  workspaces: Workspace[]
  value: string
  onChange: (id: string) => void
  onAdd?: (workspace: Workspace) => void
}
export function WorkspacePicker({
  workspaces,
  value,
  onChange,
  onAdd,
}: WorkspacePickerProps) {
  const [adding, setAdding] = useState(false)
  const [local, setLocal] = useState<Workspace[]>([])
  const options = [
    ...workspaces,
    ...local.filter(
      (item) => !workspaces.some((workspace) => workspace.id === item.id)
    ),
  ]
  const workspace = options.find((item) => item.id === value)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="选择工作目录"
            variant="ghost"
            className="mb-3 ml-2 h-7 max-w-[calc(100%-16px)] gap-1 px-2 text-[13px] font-normal"
            title={workspace?.path}
          >
            <Folder className="size-3.5" />
            <span className="truncate">
              {workspace?.name ?? "选择工作目录"}
            </span>
            <ChevronDown className="size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className="w-[220px] max-w-[calc(100vw-32px)] rounded-3xl p-1.5"
        >
          <DropdownMenuGroup>
            {options.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onSelect={() => onChange(item.id)}
                className="h-10 gap-2 rounded-xl px-3"
                title={item.path}
              >
                <Folder className="size-4" />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {workspace?.id === item.id && (
                  <Check className="size-4" aria-label="已选择" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {!!options.length && <DropdownMenuSeparator className="mx-1" />}
          <DropdownMenuItem
            className="h-10 gap-2 rounded-xl px-3"
            onSelect={() => setAdding(true)}
          >
            <Plus className="size-4" />
            添加工作区…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DirectoryPicker
        open={adding}
        onOpenChange={setAdding}
        directories={options}
        onSelect={(item) => {
          setLocal((current) =>
            current.some((entry) => entry.id === item.id)
              ? current
              : [...current, item]
          )
          onAdd?.(item)
          onChange(item.id)
        }}
      />
    </>
  )
}
