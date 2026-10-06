import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  appearance = "default",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay> & {
  appearance?: "default" | "image-preview"
}) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        appearance === "image-preview"
          ? "bg-image-preview-overlay"
          : "bg-black/30",
        className
      )}
      {...props}
    />
  )
}

const dialogContentVariants = cva(
  "fixed z-50 text-sm duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
  {
    variants: {
      variant: {
        default:
          "top-1/2 left-1/2 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 sm:max-w-sm data-open:zoom-in-95 data-closed:zoom-out-95",
        reader:
          "top-1/2 left-1/2 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-[800px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground ring-1 ring-foreground/10 data-open:zoom-in-95 data-closed:zoom-out-95 [&_[data-slot=dialog-description]]:text-xs [&_[data-slot=dialog-description]]:leading-5 [&_[data-slot=dialog-description]]:[overflow-wrap:anywhere] [&_[data-slot=dialog-header]]:max-h-[30dvh] [&_[data-slot=dialog-header]]:shrink-0 [&_[data-slot=dialog-header]]:overflow-auto [&_[data-slot=dialog-header]]:p-4 [&_[data-slot=dialog-header]]:pr-12 [&_[data-slot=dialog-title]]:leading-6 [&_[data-slot=dialog-title]]:[overflow-wrap:anywhere]",
        "image-preview":
          "inset-0 flex h-dvh w-full items-center justify-center p-4 text-image-preview-foreground sm:p-6",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function DialogContent({
  className,
  children,
  showCloseButton = true,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
} & VariantProps<typeof dialogContentVariants>) {
  return (
    <DialogPortal>
      <DialogOverlay
        appearance={variant === "image-preview" ? "image-preview" : "default"}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(dialogContentVariants({ variant }), className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant={variant === "image-preview" ? "secondary" : "ghost"}
              className={
                variant === "image-preview"
                  ? "absolute top-4 right-4"
                  : "absolute top-2 right-2"
              }
              size={variant === "image-preview" ? "icon-lg" : "icon-sm"}
            >
              <XIcon />
              <span className="sr-only">关闭</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

const dialogBodyVariants = cva("min-h-0 min-w-0", {
  variants: {
    variant: {
      default: "moon-scrollbar overflow-auto",
      document:
        "moon-scrollbar overflow-auto border-t bg-muted/30 p-4 text-sm leading-6 [overflow-wrap:anywhere] text-foreground",
      "image-preview": "flex h-full w-full items-center justify-center",
      feedback:
        "moon-scrollbar max-h-full w-full max-w-[400px] overflow-auto rounded-xl bg-popover p-4 text-popover-foreground",
    },
  },
  defaultVariants: { variant: "default" },
})

function DialogBody({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof dialogBodyVariants>) {
  return (
    <div
      data-slot={variant === "feedback" ? "dialog-feedback" : "dialog-body"}
      className={cn(dialogBodyVariants({ variant }), className)}
      {...props}
    />
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">关闭</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
