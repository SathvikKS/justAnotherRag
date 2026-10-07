import * as React from "react"
import { ArrowDown } from "lucide-react"
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
} from "@shadcn/react/message-scroller"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type MessageScrollerProps = React.ComponentProps<"div"> & {
  /** Changing this value resets the provider state, such as when switching chats. */
  sessionKey?: string | number
}

type MessageScrollerItemProps = React.ComponentProps<
  typeof MessageScrollerPrimitive.Item
> & {
  messageId: string
}

function ScrollToLatestButton() {
  const { scrollToEnd } = useMessageScroller()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Scroll to latest"
          className="absolute bottom-3 right-3 hidden rounded-full bg-background shadow-sm group-data-[scrollable~='end']/message-scroller:inline-flex motion-reduce:transition-none"
          onClick={() => scrollToEnd()}
        >
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Scroll to latest</TooltipContent>
    </Tooltip>
  )
}

function MessageScroller({
  children,
  className,
  sessionKey,
  ...props
}: MessageScrollerProps) {
  return (
    <MessageScrollerPrimitive.Provider
      key={sessionKey}
      autoScroll
      defaultScrollPosition="end"
    >
      <MessageScrollerPrimitive.Root
        data-slot="message-scroller"
        className={cn(
          "group/message-scroller relative flex min-h-0 flex-1 flex-col overflow-hidden",
          className
        )}
        {...props}
      >
        <MessageScrollerPrimitive.Viewport
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:scroll-auto"
          tabIndex={0}
          aria-label="Chat messages"
        >
          <MessageScrollerPrimitive.Content className="flex min-h-full flex-col gap-4 p-4">
            {children}
          </MessageScrollerPrimitive.Content>
        </MessageScrollerPrimitive.Viewport>
        <ScrollToLatestButton />
      </MessageScrollerPrimitive.Root>
    </MessageScrollerPrimitive.Provider>
  )
}

function MessageScrollerItem({
  className,
  ...props
}: MessageScrollerItemProps) {
  return (
    <MessageScrollerPrimitive.Item
      className={cn("min-w-0", className)}
      {...props}
    />
  )
}

export { MessageScroller, MessageScrollerItem }
export type { MessageScrollerItemProps, MessageScrollerProps }
