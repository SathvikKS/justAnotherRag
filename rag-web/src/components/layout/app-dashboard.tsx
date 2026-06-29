import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { LogOut, MessageSquare, Upload, User } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type AppDashboardProps = {
  username: string | null
  onLogout: () => void
}

export function AppDashboard({ username, onLogout }: AppDashboardProps) {
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const activeTab = pathname.startsWith("/chat") ? "chat" : "upload"

  return (
    <main className="flex h-svh flex-col bg-background text-foreground">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          void navigate({ to: value === "chat" ? "/chat" : "/upload" })
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-4">
          <div className="flex min-w-0 items-center gap-6">
            <h1 className="text-lg font-semibold">Local RAG</h1>
            <TabsList>
              <TabsTrigger value="upload" className="gap-1.5">
                <Upload className="size-4 shrink-0" aria-hidden="true" />
                Upload
              </TabsTrigger>
              <TabsTrigger value="chat" className="gap-1.5">
                <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
                Chat
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
              <User className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{username}</span>
            </div>
            <Separator orientation="vertical" className="hidden h-5 sm:block" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onLogout}
                  className="gap-1.5"
                >
                  <LogOut className="size-4 shrink-0" aria-hidden="true" />
                  <span className="hidden sm:inline">Logout</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Logout</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
          <Outlet />
        </div>
      </Tabs>
    </main>
  )
}
