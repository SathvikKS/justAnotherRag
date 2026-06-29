import * as React from "react"
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
  redirect,
  Outlet,
  useNavigate,
} from "@tanstack/react-router"
import {
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  Settings,
  Trash2,
  TriangleAlert,
  Upload,
  XCircle,
  Plus,
  LogOut,
  MessageSquare,
  User,
  Lock,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"
const GROUP_ID_REGEX = /^[A-Za-z0-9_.-]+$/
const DONE_STATES = new Set(["SUCCESS", "FAILURE", "REVOKED"])

type TaskStatus = {
  task_id: string
  state: string
  result?: {
    file_id?: string
    filename: string
    group_id: string
    chunks_indexed: number
    chunks_skipped?: number
  }
  error?: string
}

type Snippet = {
  text: string
  match_positions: number[][]
  full_length: number
}

type Source = {
  snippet: Snippet | null
  chunk_id?: string
  file_id?: string
  filename?: string
  page?: number
  group_id?: string
  score?: number
}

type ChunkDetail = {
  chunk_id: string
  text: string
  filename?: string | null
  page?: number | null
  file_id?: string | null
  group_id?: string | null
  score?: number | null
  text_quality?: string | null
  match_positions?: number[][] | null
}

type GroupSummary = {
  group_id: string
  chunks: number
  files: number
  created_at?: string | null
}

type FileSummary = {
  file_id: string
  filename: string
  group_id: string
  chunks: number
  pages: number[]
  created_at?: string | null
  legacy: boolean
}

type ChatResponse = {
  query: string
  group_id: string
  answer: string
  sources: Source[]
  grounding: Grounding
}

type DebugSearchResponse = {
  query: string
  group_id: string
  results: Source[]
}

type Grounding = {
  mode: string
  sources_supplied: number
  citations_required: boolean
  citations_found: number[]
  status: string
  raw_answer?: string
}

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  sources?: Source[]
  grounding?: Grounding
}

type QueryMode = "chat" | "search"

function makeId() {
  return crypto.randomUUID()
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { detail?: unknown }
    return typeof body.detail === "string"
      ? body.detail
      : `${response.status} ${response.statusText}`
  } catch {
    return `${response.status} ${response.statusText}`
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatScore(score: number | undefined) {
  return typeof score === "number" ? score.toFixed(3) : "unknown"
}

function highlightMatches(text: string, positions: number[][]): React.ReactNode {
  if (!positions.length) return text
  const sorted = [...positions].sort((a, b) => a[0] - b[0])
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (let i = 0; i < sorted.length; i++) {
    const [start, end] = sorted[i]
    if (start < cursor) continue
    if (start > cursor) {
      parts.push(text.slice(cursor, start))
    }
    parts.push(<mark key={i} className="rounded-sm bg-amber-500/25 px-0.5 text-foreground">{text.slice(start, end)}</mark>)
    cursor = end
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }
  return <>{parts}</>
}

export function AppDashboard() {
  const { auth } = rootRoute.useRouteContext()
  const { token, username, logout: handleLogout } = auth
  const [sessions, setSessions] = React.useState<Array<{ id: string; title: string; created_at: string }>>([])
  const [currentSessionId, setCurrentSessionId] = React.useState<string | null>(null)
  const [sessionsLoading, setSessionsLoading] = React.useState(false)

  const [groupId, setGroupId] = React.useState("demo")
  const [file, setFile] = React.useState<File | null>(null)
  const [taskId, setTaskId] = React.useState<string | null>(null)
  const [taskStatus, setTaskStatus] = React.useState<TaskStatus | null>(null)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [queryMode, setQueryMode] = React.useState<QueryMode>("chat")
  const [sourceLimit, setSourceLimit] = React.useState(5)
  const [requireCitations, setRequireCitations] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [searchResults, setSearchResults] = React.useState<Source[]>([])
  const [searchQuery, setSearchQuery] = React.useState("")
  const [chatError, setChatError] = React.useState<string | null>(null)
  const [isChatting, setIsChatting] = React.useState(false)
  const [lastQuery, setLastQuery] = React.useState("")
  const [expandedChunks, setExpandedChunks] = React.useState<Map<string, ChunkDetail>>(new Map())
  const [loadingChunks, setLoadingChunks] = React.useState<Set<string>>(new Set())
  const [groupSummary, setGroupSummary] = React.useState<GroupSummary | null>(null)
  const [indexedFiles, setIndexedFiles] = React.useState<FileSummary[]>([])
  const [managementError, setManagementError] = React.useState<string | null>(null)
  const [isRefreshingGroup, setIsRefreshingGroup] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<{ kind: "file"; fileSummary: FileSummary } | { kind: "group" } | null>(null)

  // Fetch user's chat sessions
  const fetchSessions = React.useCallback(async (selectedId?: string) => {
    if (!token) return
    setSessionsLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/chat/sessions`, {
        headers: { "Authorization": `Bearer ${token}` }
      })
      if (!res.ok) throw new Error(await readError(res))
      const data = await res.json()
      setSessions(data)
      
      // Select session logic
      if (data.length > 0) {
        if (selectedId && data.some((s: any) => s.id === selectedId)) {
          setCurrentSessionId(selectedId)
        } else if (!currentSessionId || !data.some((s: any) => s.id === currentSessionId)) {
          setCurrentSessionId(data[0].id)
        }
      } else {
        // No sessions exist, create one!
        await createSession("New Conversation")
      }
    } catch (err) {
      console.error("Failed to load sessions:", err)
    } finally {
      setSessionsLoading(false)
    }
  }, [token, currentSessionId])

  // Create new session
  const createSession = async (title?: string) => {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE_URL}/chat/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ title: title || "New Chat" })
      })
      if (!res.ok) throw new Error(await readError(res))
      const data = await res.json()
      setSessions(current => [data, ...current])
      setCurrentSessionId(data.id)
      setMessages([])
      return data.id
    } catch (err) {
      console.error("Failed to create session:", err)
    }
  }

  // Delete chat session
  const deleteSession = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!token) return
    try {
      const res = await fetch(`${API_BASE_URL}/chat/sessions/${sid}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      })
      if (!res.ok) throw new Error(await readError(res))
      
      const remaining = sessions.filter(s => s.id !== sid)
      setSessions(remaining)
      if (currentSessionId === sid) {
        if (remaining.length > 0) {
          setCurrentSessionId(remaining[0].id)
        } else {
          setCurrentSessionId(null)
          setMessages([])
          await createSession("New Conversation")
        }
      }
    } catch (err) {
      console.error("Failed to delete session:", err)
    }
  }

  // Load messages for current session
  const loadMessages = React.useCallback(async (sid: string) => {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE_URL}/chat/sessions/${sid}/messages`, {
        headers: { "Authorization": `Bearer ${token}` }
      })
      if (!res.ok) throw new Error(await readError(res))
      const data = await res.json()
      setMessages(data)
    } catch (err) {
      console.error("Failed to load messages:", err)
    }
  }, [token])

  // Trigger loading of messages when session changes
  React.useEffect(() => {
    if (currentSessionId) {
      void loadMessages(currentSessionId)
    }
  }, [currentSessionId, loadMessages])

  // Fetch sessions on login / load
  React.useEffect(() => {
    if (token) {
      void fetchSessions()
    }
  }, [token])



  const refreshGroup = React.useCallback(async function refreshGroup() {
    const cleanGroupId = groupId.trim()
    if (!GROUP_ID_REGEX.test(cleanGroupId)) {
      setManagementError("Use a valid group id before refreshing.")
      setGroupSummary(null)
      setIndexedFiles([])
      return
    }

    setIsRefreshingGroup(true)
    setManagementError(null)
    try {
      const [groupResponse, filesResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/groups/${encodeURIComponent(cleanGroupId)}`),
          fetch(`${API_BASE_URL}/groups/${encodeURIComponent(cleanGroupId)}/files`),
      ])

      if (groupResponse.status === 404) {
        setGroupSummary(null)
        setIndexedFiles([])
      } else if (!groupResponse.ok) {
        throw new Error(await readError(groupResponse))
      } else {
        setGroupSummary((await groupResponse.json()) as GroupSummary)
      }

      if (filesResponse.status === 404) {
        setIndexedFiles([])
      } else if (!filesResponse.ok) {
        throw new Error(await readError(filesResponse))
      } else {
        setIndexedFiles((await filesResponse.json()) as FileSummary[])
      }
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRefreshingGroup(false)
    }
  }, [groupId])

  React.useEffect(() => {
    if (!taskId) {
      return undefined
    }

    let cancelled = false
    let timeoutId: number | undefined

    async function poll() {
      try {
        const response = await fetch(`${API_BASE_URL}/status/${taskId}`)
        if (!response.ok) {
          throw new Error(await readError(response))
        }

        const status = (await response.json()) as TaskStatus
        if (cancelled) {
          return
        }

        setTaskStatus(status)
        if (!DONE_STATES.has(status.state)) {
          timeoutId = window.setTimeout(poll, 1500)
        }
      } catch (error) {
        if (!cancelled) {
          setUploadError(error instanceof Error ? error.message : String(error))
        }
      }
    }

    poll()

    return () => {
      cancelled = true
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [taskId])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => void refreshGroup(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [refreshGroup])

  React.useEffect(() => {
    if (taskStatus?.state === "SUCCESS") {
      const timeoutId = window.setTimeout(() => void refreshGroup(), 0)
      return () => window.clearTimeout(timeoutId)
    }
    return undefined
  }, [refreshGroup, taskStatus?.state])

  function pickFile(nextFile: File | undefined) {
    setUploadError(null)
    if (!nextFile) {
      return
    }

    if (!nextFile.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Only PDF files are supported.")
      return
    }

    setFile(nextFile)
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    pickFile(event.dataTransfer.files[0])
  }

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault()
    const cleanGroupId = groupId.trim()

    if (!file) {
      setUploadError("Choose a PDF first.")
      return
    }

    if (!GROUP_ID_REGEX.test(cleanGroupId)) {
      setUploadError("Use letters, numbers, underscores, dots, or hyphens.")
      return
    }

    const formData = new FormData()
    formData.append("file", file)
    formData.append("group_id", cleanGroupId)

    setIsUploading(true)
    setUploadError(null)
    setTaskId(null)
    setTaskStatus(null)

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: "POST",
        body: formData,
      })
      if (!response.ok) {
        throw new Error(await readError(response))
      }

      const body = (await response.json()) as { task_id: string }
      setTaskId(body.task_id)
      setTaskStatus({ task_id: body.task_id, state: "PENDING" })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsUploading(false)
    }
  }

  async function loadFullChunk(chunkId: string) {
    if (expandedChunks.has(chunkId) || loadingChunks.has(chunkId)) return
    setLoadingChunks((prev) => new Set(prev).add(chunkId))
    try {
      const params = new URLSearchParams()
      if (lastQuery) params.set("q", lastQuery)
      const url = `${API_BASE_URL}/chunks/${encodeURIComponent(chunkId)}${params.toString() ? "?" + params.toString() : ""}`
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(await readError(response))
      }
      const detail = (await response.json()) as ChunkDetail
      setExpandedChunks((prev) => {
        const next = new Map(prev)
        next.set(chunkId, detail)
        return next
      })
    } catch (error) {
      console.error("Failed to load chunk:", error)
    } finally {
      setLoadingChunks((prev) => {
        const next = new Set(prev)
        next.delete(chunkId)
        return next
      })
    }
  }

  function collapseChunk(chunkId: string) {
    setExpandedChunks((prev) => {
      const next = new Map(prev)
      next.delete(chunkId)
      return next
    })
  }

  async function handleDeleteFile(fileSummary: FileSummary) {
    setDeleteTarget({ kind: "file", fileSummary })
  }

  async function confirmDeleteFile() {
    if (deleteTarget?.kind !== "file") return
    const { fileSummary } = deleteTarget
    setDeleteTarget(null)
    setManagementError(null)
    try {
      const response = await fetch(
        `${API_BASE_URL}/groups/${encodeURIComponent(fileSummary.group_id)}/files/${encodeURIComponent(fileSummary.file_id)}`,
        { method: "DELETE" },
      )
      if (!response.ok) {
        throw new Error(await readError(response))
      }
      setMessages([])
      setSearchResults([])
      setSearchQuery("")
      await refreshGroup()
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleDeleteGroup() {
    setDeleteTarget({ kind: "group" })
  }

  async function confirmDeleteGroup() {
    const cleanGroupId = groupId.trim()
    if (!GROUP_ID_REGEX.test(cleanGroupId)) {
      setManagementError("Use a valid group id before deleting.")
      setDeleteTarget(null)
      return
    }
    setDeleteTarget(null)
    setManagementError(null)
    try {
      const response = await fetch(
        `${API_BASE_URL}/groups/${encodeURIComponent(cleanGroupId)}`,
        { method: "DELETE" },
      )
      if (!response.ok) {
        throw new Error(await readError(response))
      }
      setGroupSummary(null)
      setIndexedFiles([])
      setMessages([])
      setSearchResults([])
      setSearchQuery("")
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleChat(event: React.FormEvent) {
    event.preventDefault()
    const cleanQuery = query.trim()
    const cleanGroupId = groupId.trim()

    if (!cleanQuery) {
      return
    }

    if (!GROUP_ID_REGEX.test(cleanGroupId)) {
      setChatError(`Set a valid group id before ${queryMode === "chat" ? "chatting" : "searching"}.`)
      return
    }

    let activeSessionId = currentSessionId
    if (queryMode === "chat") {
      if (!activeSessionId) {
        setChatError("No active chat session. Creating one...")
        activeSessionId = await createSession(cleanQuery.slice(0, 30))
        if (!activeSessionId) return
      }

      const userMessage: ChatMessage = {
        id: makeId(),
        role: "user",
        content: cleanQuery,
      }

      setMessages((current) => [...current, userMessage])
    }
    setQuery("")
    setChatError(null)
    setIsChatting(true)
    setLastQuery(cleanQuery)

    try {
      if (queryMode === "search") {
        const response = await fetch(`${API_BASE_URL}/debug/search`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            query: cleanQuery,
            group_id: cleanGroupId,
            limit: sourceLimit,
          }),
        })
        if (!response.ok) {
          throw new Error(await readError(response))
        }

        const body = (await response.json()) as DebugSearchResponse
        setSearchQuery(body.query)
        setSearchResults(body.results)
        return
      }

      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          query: cleanQuery,
          group_id: cleanGroupId,
          limit: sourceLimit,
          require_citations: requireCitations,
          session_id: activeSessionId,
        }),
      })
      if (!response.ok) {
        throw new Error(await readError(response))
      }

      const body = (await response.json()) as ChatResponse
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          content: body.answer,
          sources: body.sources,
          grounding: body.grounding,
        },
      ])

      if (activeSessionId) {
        void fetchSessions(activeSessionId)
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsChatting(false)
    }
  }

  const statusState = taskStatus?.state ?? "IDLE"
  const statusIcon =
    statusState === "SUCCESS" ? (
      <CheckCircle2 className="size-4 text-emerald-600" />
    ) : statusState === "FAILURE" || statusState === "REVOKED" ? (
      <XCircle className="size-4 text-destructive" />
    ) : taskId ? (
      <Loader2 className="size-4 animate-spin text-primary" />
    ) : (
      <FileText className="size-4 text-muted-foreground" />
    )

  return (
    <main className="h-svh bg-background text-foreground">
      <div className="mx-auto grid h-svh w-full max-w-7xl gap-4 p-4 lg:grid-cols-[260px_320px_1fr] lg:p-6">
        {/* Column 1: Conversations */}
        <section className="flex min-w-0 flex-col gap-4 overflow-y-auto rounded-md border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between border-b pb-3">
            <h2 className="font-semibold text-lg">Conversations</h2>
            <Button
              size="icon"
              variant="outline"
              onClick={() => void createSession("New Chat")}
              title="New Chat"
              className="size-8"
            >
              <Plus className="size-4" />
            </Button>
          </div>
          
          <ScrollArea className="flex-1 -mx-2 px-2">
            <div className="flex flex-col gap-1 py-1">
              {sessionsLoading && sessions.length === 0 ? (
                <div className="flex justify-center p-4">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No conversations yet.</p>
              ) : (
                sessions.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setCurrentSessionId(s.id)}
                    className={`flex items-center justify-between group rounded-md px-3 py-2 text-xs text-left transition ${currentSessionId === s.id ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted text-foreground"}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                      <MessageSquare className="size-3.5 shrink-0 opacity-70" />
                      <span className="truncate">{s.title}</span>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      type="button"
                      onClick={(e) => void deleteSession(s.id, e)}
                      className="size-5 p-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <Trash2 className="size-3" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>

          <div className="mt-auto border-t pt-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <User className="size-3.5" />
              <span className="truncate">{username}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-1.5 h-8 text-xs font-semibold"
            >
              <LogOut className="size-3.5" />
              Logout
            </Button>
          </div>
        </section>

        {/* Column 2: Document Indexer */}
        <section className="flex min-w-0 flex-col gap-4 overflow-y-auto rounded-md border bg-card p-4 shadow-sm">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-normal">Local RAG</h1>
            <p className="text-sm text-muted-foreground">
              Index PDFs and query a document group.
            </p>
          </div>

          <form className="flex flex-col gap-4" onSubmit={handleUpload}>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Group
              <input
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/20"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                placeholder="demo"
              />
            </label>

            <label
              className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-muted/40 p-4 text-center transition hover:bg-muted"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                className="sr-only"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => pickFile(event.target.files?.[0])}
              />
              <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Upload className="size-5" />
              </span>
              <span className="max-w-full truncate text-sm font-medium">
                {file ? file.name : "Drop PDF"}
              </span>
              <span className="text-xs text-muted-foreground">
                {file ? formatBytes(file.size) : "or browse"}
              </span>
            </label>

            <Button type="submit" disabled={isUploading}>
              {isUploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Upload
            </Button>
          </form>

          <div className="flex min-h-24 flex-col gap-2 rounded-md border bg-background p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              {statusIcon}
              <span>{statusState}</span>
            </div>
            {taskId ? (
              <p className="break-all font-mono text-xs text-muted-foreground">
                {taskId}
              </p>
            ) : null}
            {taskStatus?.result ? (
              <p className="text-sm text-muted-foreground">
                {taskStatus.result.chunks_indexed} chunks indexed from{" "}
                {taskStatus.result.filename}
                {taskStatus.result.chunks_skipped
                  ? ` (${taskStatus.result.chunks_skipped} skipped).`
                  : "."}
              </p>
            ) : null}
            {taskStatus?.error || uploadError ? (
              <p className="text-sm text-destructive">
                {taskStatus?.error ?? uploadError}
              </p>
            ) : null}
          </div>

          <div className="flex min-h-40 flex-col gap-3 rounded-md border bg-background p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <Database className="size-4 text-muted-foreground" />
                <span>Indexed Data</span>
              </div>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => void refreshGroup()}
                disabled={isRefreshingGroup}
              >
                {isRefreshingGroup ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Refresh
              </Button>
            </div>

            {groupSummary ? (
              <p className="text-sm text-muted-foreground">
                {groupSummary.files} files, {groupSummary.chunks} chunks in{" "}
                {groupSummary.group_id}.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No indexed files loaded for this group.
              </p>
            )}

            {indexedFiles.length ? (
              <ScrollArea className="max-h-48">
                <div className="flex flex-col gap-2">
                  {indexedFiles.map((item) => (
                    <div
                      key={item.file_id}
                      className="flex items-center justify-between gap-2 rounded-md border p-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.chunks} chunks
                          {item.pages.length ? `, ${item.pages.length} pages` : ""}
                          {item.legacy ? ", legacy" : ""}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        type="button"
                        variant="destructive"
                        onClick={() => void handleDeleteFile(item)}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Delete file embeddings</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : null}

            {groupSummary ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDeleteGroup()}
              >
                <Trash2 className="size-4" />
                Delete group embeddings
              </Button>
            ) : null}

            {managementError ? (
              <p className="text-sm text-destructive">{managementError}</p>
            ) : null}
          </div>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings className="size-4" />
                Chat Settings
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="flex flex-col gap-6">
              <SheetHeader>
                <SheetTitle>Query Settings</SheetTitle>
                <SheetDescription>
                  Configure retrieval for both query modes and grounding for AI answers.
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-col gap-4 px-6">
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex items-center justify-between font-medium">
                    <span>Sources to retrieve</span>
                    <span className="tabular-nums text-muted-foreground">{sourceLimit}</span>
                  </div>
                  <Slider
                    value={[sourceLimit]}
                    onValueChange={([value]) => setSourceLimit(value)}
                    min={1}
                    max={20}
                    step={1}
                  />
                </div>

                <label className="flex items-start gap-2 text-sm">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={requireCitations}
                    disabled={queryMode === "search"}
                    onChange={(event) => setRequireCitations(event.target.checked)}
                  />
                  <span>
                    <span className="block font-medium">Require source citations</span>
                    <span className="block text-xs text-muted-foreground">
                      {queryMode === "search"
                        ? "Citation enforcement only applies when asking the AI."
                        : "When enabled, uncited document answers are replaced with an insufficient-context response."}
                    </span>
                  </span>
                </label>
              </div>
            </SheetContent>
          </Sheet>
        </section>

        <section className="flex min-h-[70svh] min-w-0 flex-col rounded-md border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-normal">
                  {queryMode === "chat" ? "Ask AI" : "Search Vector DB"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Current group: {groupId.trim() || "none"}
                </p>
              </div>
              <div className="grid grid-cols-2 rounded-md border bg-muted p-1 text-sm">
                <button
                  type="button"
                  className={`rounded-sm px-3 py-1.5 font-medium transition ${queryMode === "chat" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setQueryMode("chat")}
                >
                  Ask AI
                </button>
                <button
                  type="button"
                  className={`rounded-sm px-3 py-1.5 font-medium transition ${queryMode === "search" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setQueryMode("search")}
                >
                  Vector DB
                </button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {queryMode === "chat"
                ? "Ask the LLM to answer using retrieved chunks from the selected group."
                : "Inspect raw vector-search matches directly from the selected group before any LLM generation."}
            </p>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-4 p-4">
            {queryMode === "search" ? (
              searchResults.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed px-4 text-center text-sm text-muted-foreground">
                  Search the current group to inspect raw retrieval hits.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p className="font-medium">
                      {searchResults.length} raw results for "{searchQuery}"
                    </p>
                    <span className="text-muted-foreground">No LLM generation used</span>
                  </div>
                  {searchResults.map((result, index) => {
                    const snippet = result.snippet
                    const chunkId = result.chunk_id
                    const isExpanded = chunkId ? expandedChunks.has(chunkId) : false
                    const isLoading = chunkId ? loadingChunks.has(chunkId) : false
                    const full = chunkId ? expandedChunks.get(chunkId) : undefined

                    return (
                    <article
                      key={`${result.chunk_id ?? result.file_id ?? "result"}-${index}`}
                      className="rounded-md border bg-background p-3 text-sm"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2 font-medium">
                        <span>
                          [{index + 1}] {result.filename ?? "source"}
                          {result.page ? ` p.${result.page}` : ""}
                        </span>
                        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          score {formatScore(result.score)}
                        </span>
                        {result.group_id ? (
                          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {result.group_id}
                          </span>
                        ) : null}
                      </div>
                      {snippet ? (
                        <div>
                          <p className="whitespace-pre-wrap break-words leading-6 text-muted-foreground">
                            {highlightMatches(snippet.text, snippet.match_positions)}
                            {snippet.full_length > snippet.text.length ? "..." : null}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            {chunkId ? (
                              isExpanded ? (
                                <button
                                  type="button"
                                  className="rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition"
                                  onClick={() => collapseChunk(chunkId)}
                                >
                                  Hide full chunk
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition"
                                  disabled={isLoading}
                                  onClick={() => void loadFullChunk(chunkId)}
                                >
                                  {isLoading ? "Loading..." : "Show full chunk"}
                                </button>
                              )
                            ) : null}
                          </div>
                          {isExpanded && full ? (
                            <div className="mt-2 rounded-md border bg-muted/30 p-2 text-xs leading-6 whitespace-pre-wrap break-words">
                              {highlightMatches(full.text, full.match_positions ?? [])}
                              {full.text_quality ? (
                                <p className="mt-2 text-muted-foreground">
                                  quality: {full.text_quality}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-xs italic">No snippet available</p>
                      )}
                    </article>
                    )
                  })}
                </div>
              )
            ) : messages.length === 0 ? (
              <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                Ask a question after indexing.
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[82%] break-words rounded-md bg-primary p-3 text-sm text-primary-foreground"
                      : "mr-auto max-w-[88%] break-words rounded-md border bg-background p-3 text-sm"
                  }
                >
                  {message.role === "assistant" ? (
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      {message.grounding?.status === "cited" ? (
                        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-300">
                          Cited: {message.grounding.citations_found.join(", ")}
                        </span>
                      ) : message.grounding?.status === "rejected_uncited" ? (
                        <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-1 font-medium text-destructive">
                          Uncited: rejected
                        </span>
                      ) : message.grounding?.status === "uncited" ? (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-medium text-amber-700 dark:text-amber-300">
                          Uncited
                        </span>
                      ) : message.sources?.length ? (
                        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-300">
                          Sources supplied: {message.sources.length}
                        </span>
                      ) : (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-medium text-amber-700 dark:text-amber-300">
                          No document sources supplied
                        </span>
                      )}
                      {message.grounding?.citations_required ? (
                        <span className="text-muted-foreground">
                          Citation enforcement was enabled.
                        </span>
                      ) : message.sources?.length ? (
                        <span className="text-muted-foreground">
                          Citation checks were off; answer was not rejected.
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          This response did not use retrieved chunks.
                        </span>
                      )}
                    </div>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words leading-6">
                    {message.content}
                  </p>
                  {message.grounding?.raw_answer ? (
                    <details className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                      <summary className="cursor-pointer text-xs font-medium text-destructive">
                        Show rejected raw answer
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {message.grounding.raw_answer}
                      </p>
                    </details>
                  ) : null}
                  {message.sources?.length ? (
                    <details className="mt-3 rounded-md border bg-muted/30 p-2">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        Show document evidence
                      </summary>
                      <div className="mt-2 flex flex-col gap-2">
                      {message.sources.map((result, index) => {
                        const snippet = result.snippet
                        const chunkId = result.chunk_id
                        const isExpanded = chunkId ? expandedChunks.has(chunkId) : false
                        const isLoading = chunkId ? loadingChunks.has(chunkId) : false
                        const full = chunkId ? expandedChunks.get(chunkId) : undefined

                        return (
                        <div
                          key={`${message.id}-${index}`}
                          className="rounded-md border bg-background p-2 text-xs"
                        >
                          <div className="mb-1 flex flex-wrap items-center gap-2 font-medium">
                            <span>
                              [{index + 1}] {result.filename ?? "source"}
                              {result.page ? ` p.${result.page}` : ""}
                            </span>
                            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">
                              score {formatScore(result.score)}
                            </span>
                          </div>
                          {snippet ? (
                            <div>
                              <p className="break-words text-muted-foreground">
                                {highlightMatches(snippet.text, snippet.match_positions)}
                                {snippet.full_length > snippet.text.length ? "..." : null}
                              </p>
                              <div className="mt-1 flex items-center gap-2">
                                {chunkId ? (
                                  isExpanded ? (
                                    <button
                                      type="button"
                                      className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition"
                                      onClick={() => collapseChunk(chunkId)}
                                    >
                                      Hide full chunk
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition"
                                      disabled={isLoading}
                                      onClick={() => void loadFullChunk(chunkId)}
                                    >
                                      Show full chunk
                                    </button>
                                  )
                                ) : null}
                              </div>
                              {isExpanded && full ? (
                                <div className="mt-1.5 rounded-sm border bg-muted/30 p-1.5 text-[11px] leading-5 whitespace-pre-wrap break-words">
                                  {highlightMatches(full.text, full.match_positions ?? [])}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-muted-foreground italic">No snippet available</p>
                          )}
                        </div>
                        )
                      })}
                      </div>
                    </details>
                  ) : null}
                </article>
              ))
            )}
            </div>
          </ScrollArea>

          <form className="border-t p-4" onSubmit={handleChat}>
            {chatError ? (
              <p className="mb-2 text-sm text-destructive">{chatError}</p>
            ) : null}
            <div className="flex gap-2">
              <input
                className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/20"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={queryMode === "chat" ? "Ask about the indexed PDFs" : "Search indexed chunks directly"}
              />
              <Button size="icon" type="submit" disabled={isChatting}>
                {isChatting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                <span className="sr-only">Send</span>
              </Button>
            </div>
          </form>
        </section>
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-destructive" />
              {deleteTarget?.kind === "file" ? "Delete file embeddings" : "Delete group embeddings"}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.kind === "file"
                ? `Permanently delete embeddings for ${deleteTarget.fileSummary.filename} from ${deleteTarget.fileSummary.group_id}?`
                : `Permanently delete all embeddings for group ${groupId.trim()}?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (deleteTarget?.kind === "file") void confirmDeleteFile(); else void confirmDeleteGroup() }}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

interface MyRouterContext {
  auth: {
    token: string | null
    username: string | null
    login: (token: string, username: string) => void
    logout: () => void
  }
}

const rootRoute = createRootRouteWithContext<MyRouterContext>()({
  component: () => (
    <Outlet />
  ),
})

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  beforeLoad: ({ context }) => {
    if (!context.auth.token) {
      throw redirect({
        to: "/login",
      })
    }
  },
  component: () => <Outlet />,
})

const indexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/",
  component: AppDashboard,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: ({ context }) => {
    if (context.auth.token) {
      throw redirect({
        to: "/",
      })
    }
  },
  component: LoginPage,
})

const routeTree = rootRoute.addChildren([
  authenticatedRoute.addChildren([indexRoute]),
  loginRoute,
])

const router = createRouter({
  routeTree,
  context: {
    auth: undefined!,
  },
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

function LoginPage() {
  const { auth } = rootRoute.useRouteContext()
  const [authUsername, setAuthUsername] = React.useState("")
  const [authPassword, setAuthPassword] = React.useState("")
  const [authLoading, setAuthLoading] = React.useState(false)
  const [authError, setAuthError] = React.useState<string | null>(null)
  const [authMode, setAuthMode] = React.useState<"login" | "register">("login")
  const navigate = useNavigate()

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    if (!authUsername.trim() || !authPassword.trim()) {
      setAuthError("All fields are required")
      return
    }
    setAuthLoading(true)
    try {
      if (authMode === "register") {
        const res = await fetch(`${API_BASE_URL}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: authUsername.trim(), password: authPassword.trim() })
        })
        if (!res.ok) throw new Error(await readError(res))
      }

      const params = new URLSearchParams()
      params.append("username", authUsername.trim())
      params.append("password", authPassword.trim())
      
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
      })
      if (!res.ok) throw new Error(await readError(res))
      
      const data = await res.json()
      auth.login(data.access_token, data.username)
      void navigate({ to: "/" })
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err))
    } finally {
      setAuthLoading(false)
    }
  }

  return (
    <main className="flex h-svh w-screen items-center justify-center bg-zinc-950 text-foreground font-sans">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col items-center gap-2 text-center mb-8">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="size-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Local RAG Auth</h1>
          <p className="text-sm text-muted-foreground">
            Sign in or create a new account to continue
          </p>
        </div>

        <form onSubmit={handleAuthSubmit} className="flex flex-col gap-4">
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            <button
              type="button"
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition ${authMode === "login" ? "bg-zinc-800 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => {
                setAuthMode("login")
                setAuthError(null)
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition ${authMode === "register" ? "bg-zinc-800 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => {
                setAuthMode("register")
                setAuthError(null)
              }}
            >
              Sign Up
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Username</label>
            <div className="relative">
              <input
                type="text"
                required
                placeholder="enter username"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none transition focus:border-zinc-700"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Password</label>
            <div className="relative">
              <input
                type="password"
                required
                placeholder="enter password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none transition focus:border-zinc-700"
              />
            </div>
          </div>

          {authError ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive font-medium">
              <TriangleAlert className="size-4 shrink-0" />
              <span>{authError}</span>
            </div>
          ) : null}

          <Button type="submit" disabled={authLoading} className="h-10 font-semibold w-full mt-2">
            {authLoading ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : null}
            {authMode === "login" ? "Sign In" : "Sign Up"}
          </Button>
        </form>
      </div>
    </main>
  )
}

export function App() {
  const [token, setToken] = React.useState<string | null>(() => localStorage.getItem("token"))
  const [username, setUsername] = React.useState<string | null>(() => localStorage.getItem("username"))

  const login = (newToken: string, newUsername: string) => {
    localStorage.setItem("token", newToken)
    localStorage.setItem("username", newUsername)
    setToken(newToken)
    setUsername(newUsername)
  }

  const logout = () => {
    localStorage.removeItem("token")
    localStorage.removeItem("username")
    setToken(null)
    setUsername(null)
  }

  return (
    <RouterProvider
      router={router}
      context={{
        auth: {
          token,
          username,
          login,
          logout,
        },
      }}
    />
  )
}

export default App
