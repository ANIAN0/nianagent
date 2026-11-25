"use client"

import * as React from "react"
import {
  Toggle as TogglePrimitive,
  ToggleGroup as ToggleGroupPrimitive,
} from "@ui-sdk/react/toggle"
import { type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { toggleVariants } from "./toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
  variant: "default",
})

type ToggleGroupSingleProps = {
  type?: "single"
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

type ToggleGroupMultipleProps = {
  type: "multiple"
  value?: string[]
  defaultValue?: string[]
  onValueChange?: (value: string[]) => void
}

function ToggleGroup({
  className,
  variant,
  size,
  type = "single",
  value,
  defaultValue,
  onValueChange,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof ToggleGroupPrimitive>,
  "value" | "defaultValue" | "onValueChange" | "multiple" | "children"
> & {
  children?: React.ReactNode
} & VariantProps<typeof toggleVariants> &
  (ToggleGroupSingleProps | ToggleGroupMultipleProps)) {
  const isMultiple = type === "multiple"
  const normalizedValue =
    value === undefined
      ? undefined
      : Array.isArray(value)
        ? value
        : value
          ? [value]
          : []
  const normalizedDefault =
    defaultValue === undefined
      ? undefined
      : Array.isArray(defaultValue)
        ? defaultValue
        : defaultValue
          ? [defaultValue]
          : []

  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      multiple={isMultiple}
      value={normalizedValue}
      defaultValue={normalizedDefault}
      onValueChange={(next) => {
        if (isMultiple) {
          ;(onValueChange as ((v: string[]) => void) | undefined)?.(next)
        } else {
          ;(onValueChange as ((v: string) => void) | undefined)?.(next[0] ?? "")
        }
      }}
      className={cn("flex w-fit flex-row items-center gap-1", className)}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        "shrink-0 focus:z-10 focus-visible:z-10",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
