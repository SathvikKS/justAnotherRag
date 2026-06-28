import * as React from "react"
import {
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"

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

type Source = {
  text: string
  chunk_id?: string
  file_id?: string
  filename?: string
  page?: number
  group_id?: string
  score?: number
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

type Grounding = {
  mode: string
  sources_supplied: number
  citations_required: boolean
  citations_found: number[]
  status: string
}

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  sources?: Source[]
  grounding?: Grounding
}

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

function previewText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim()
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized
}

export function App() {
  const [groupId, setGroupId] = React.useState("demo")
  const [file, setFile] = React.useState<File | null>(null)
  const [taskId, setTaskId] = React.useState<string | null>(null)
  const [taskStatus, setTaskStatus] = React.useState<TaskStatus | null>(null)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [sourceLimit, setSourceLimit] = React.useState(5)
  const [requireCitations, setRequireCitations] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [chatError, setChatError] = React.useState<string | null>(null)
  const [isChatting, setIsChatting] = React.useState(false)
  const [groupSummary, setGroupSummary] = React.useState<GroupSummary | null>(null)
  const [indexedFiles, setIndexedFiles] = React.useState<FileSummary[]>([])
  const [managementError, setManagementError] = React.useState<string | null>(null)
  const [isRefreshingGroup, setIsRefreshingGroup] = React.useState(false)

  async function refreshGroup() {
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
  }

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
    if (taskStatus?.state === "SUCCESS") {
      void refreshGroup()
    }
  }, [taskStatus?.state])

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

  async function handleDeleteFile(fileSummary: FileSummary) {
    if (
      !window.confirm(
        `Permanently delete embeddings for ${fileSummary.filename} from ${fileSummary.group_id}?`,
      )
    ) {
      return
    }

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
      await refreshGroup()
    } catch (error) {
      setManagementError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleDeleteGroup() {
    const cleanGroupId = groupId.trim()
    if (!GROUP_ID_REGEX.test(cleanGroupId)) {
      setManagementError("Use a valid group id before deleting.")
      return
    }

    if (
      !window.confirm(
        `Permanently delete all embeddings for group ${cleanGroupId}?`,
      )
    ) {
      return
    }

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
      setChatError("Set a valid group id before chatting.")
      return
    }

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: cleanQuery,
    }

    setMessages((current) => [...current, userMessage])
    setQuery("")
    setChatError(null)
    setIsChatting(true)

    try {
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
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto grid min-h-svh w-full max-w-7xl gap-4 p-4 lg:grid-cols-[360px_1fr] lg:p-6">
        <section className="flex min-w-0 flex-col gap-4 rounded-md border bg-card p-4 shadow-sm">
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
                      variant="outline"
                      onClick={() => void handleDeleteFile(item)}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Delete file embeddings</span>
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {groupSummary ? (
              <Button
                type="button"
                variant="outline"
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

          <div className="flex flex-col gap-3 rounded-md border bg-background p-3">
            <div>
              <h3 className="text-sm font-medium">Chat Settings</h3>
              <p className="text-xs text-muted-foreground">
                Configure retrieval and grounding per request.
              </p>
            </div>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Sources to retrieve
              <input
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/20"
                type="number"
                min={1}
                max={20}
                value={sourceLimit}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setSourceLimit(Number.isFinite(value) ? Math.min(20, Math.max(1, value)) : 5)
                }}
              />
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={requireCitations}
                onChange={(event) => setRequireCitations(event.target.checked)}
              />
              <span>
                <span className="block font-medium">Require source citations</span>
                <span className="block text-xs text-muted-foreground">
                  When enabled, uncited document answers are replaced with an
                  insufficient-context response.
                </span>
              </span>
            </label>
          </div>
        </section>

        <section className="flex min-h-[70svh] min-w-0 flex-col rounded-md border bg-card shadow-sm">
          <div className="border-b p-4">
            <h2 className="text-lg font-semibold tracking-normal">Chat</h2>
            <p className="text-sm text-muted-foreground">
              Current group: {groupId.trim() || "none"}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                Ask a question after indexing.
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[82%] rounded-md bg-primary p-3 text-sm text-primary-foreground"
                      : "mr-auto max-w-[88%] rounded-md border bg-background p-3 text-sm"
                  }
                >
                  {message.role === "assistant" ? (
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      {message.grounding?.status === "cited" ? (
                        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-300">
                          Grounded with citations: {message.grounding.citations_found.join(", ")}
                        </span>
                      ) : message.grounding?.status === "rejected_uncited" ? (
                        <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-1 font-medium text-destructive">
                          Rejected: no valid citations
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
                          Citation checks were off; verify against evidence below.
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
                  {message.sources?.length ? (
                    <details className="mt-3 rounded-md border bg-muted/30 p-2">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        Show document evidence
                      </summary>
                      <div className="mt-2 flex flex-col gap-2">
                      {message.sources.map((result, index) => (
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
                          <p className="break-words text-muted-foreground">
                            {previewText(result.text)}
                          </p>
                        </div>
                      ))}
                      </div>
                    </details>
                  ) : null}
                </article>
              ))
            )}
          </div>

          <form className="border-t p-4" onSubmit={handleChat}>
            {chatError ? (
              <p className="mb-2 text-sm text-destructive">{chatError}</p>
            ) : null}
            <div className="flex gap-2">
              <input
                className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/20"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ask about the indexed PDFs"
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
    </main>
  )
}

export default App
