"use client";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "待审批",
  "approval-responded": "已响应",
  "input-available": "执行中",
  "input-streaming": "准备中",
  "output-available": "已完成",
  "output-denied": "已拒绝",
  "output-error": "错误",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": (
    <ClockIcon className="size-3.5 text-amber-700 dark:text-amber-400" />
  ),
  "approval-responded": (
    <CheckCircleIcon className="size-3.5 text-muted-foreground" />
  ),
  "input-available": (
    <ClockIcon className="size-3.5 animate-pulse text-muted-foreground" />
  ),
  "input-streaming": <CircleIcon className="size-3.5 text-muted-foreground" />,
  "output-available": (
    <CheckCircleIcon className="size-3.5 text-emerald-700 dark:text-emerald-400" />
  ),
  "output-denied": (
    <XCircleIcon className="size-3.5 text-amber-700 dark:text-amber-400" />
  ),
  "output-error": (
    <XCircleIcon className="size-3.5 text-destructive" />
  ),
};

export const getStatusBadge = (status: ToolPart["state"]) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const derivedName = type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  return (
    <CollapsibleTrigger
      className={cn("flex w-full items-center justify-between gap-4 p-3", className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title ?? derivedName}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
      参数
    </h4>
    <div className="rounded-md bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  // 错误优先：失败态必须醒目展示文案，不与成功 Result 混排
  if (errorText) {
    return (
      <div className={cn("space-y-2", className)} {...props}>
        <h4 className="font-medium text-destructive text-xs uppercase tracking-wide">
          错误
        </h4>
        <div
          className="overflow-x-auto rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive text-xs"
          role="alert"
        >
          <pre className="whitespace-pre-wrap break-words font-mono leading-relaxed">
            {errorText}
          </pre>
        </div>
      </div>
    );
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />;
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        结果
      </h4>
      <div className="overflow-x-auto rounded-md bg-muted/50 text-foreground text-xs [&_table]:w-full">
        {Output}
      </div>
    </div>
  );
};
