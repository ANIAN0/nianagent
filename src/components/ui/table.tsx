import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const tableVariants = cva("w-full caption-bottom", {
  variants: {
    variant: {
      default: "text-sm",
      compact:
        "text-[13px] leading-5 [&_[data-slot=table-cell]]:px-2 [&_[data-slot=table-cell]]:py-3 [&_[data-slot=table-cell]]:break-words [&_[data-slot=table-cell]]:whitespace-normal [&_[data-slot=table-cell]:has([role=checkbox])]:pr-2 [&_[data-slot=table-head]]:h-8 [&_[data-slot=table-head]]:text-xs [&_[data-slot=table-head]]:leading-[18px] [&_[data-slot=table-head]]:text-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
})

function Table({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"table"> & VariantProps<typeof tableVariants>) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        data-variant={variant}
        className={cn(tableVariants({ variant }), className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"td"> & { variant?: "default" | "secondary" }) {
  return (
    <td
      data-slot="table-cell"
      data-variant={variant}
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        variant === "secondary" &&
          "text-xs leading-[18px] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function TableCellDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="table-cell-description"
      className={cn(
        "text-xs leading-[18px] break-words whitespace-pre-wrap text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCellDescription,
  TableCaption,
}
