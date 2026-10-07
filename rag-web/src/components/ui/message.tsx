import * as React from "react"

import { cn } from "@/lib/utils"

type MessageProps = React.ComponentProps<"div"> & {
  align?: "start" | "end"
}

function Message({ align = "start", className, ...props }: MessageProps) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "flex w-full min-w-0",
        align === "end" ? "justify-end" : "justify-start",
        className
      )}
      {...props}
    />
  )
}

function Bubble({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble"
      className={cn(
        "min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-foreground [overflow-wrap:anywhere] [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_code]:py-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-background [&_pre]:p-3",
        className
      )}
      {...props}
    />
  )
}

export { Bubble, Message }
export type { MessageProps }
