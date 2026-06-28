import * as React from "react"
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

export function App() {
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

    if (queryMode === "chat") {
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
          headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: cleanQuery,
          group_id: cleanGroupId,
          limit: sourceLimit,
          require_citations: requireCitations,
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
      <div className="mx-auto grid h-svh w-full max-w-7xl gap-4 p-4 lg:grid-cols-[360px_1fr] lg:p-6">
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

export default App
