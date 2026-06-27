import * as React from "react"
import {
  CheckCircle2,
  FileText,
  Loader2,
  Send,
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
    filename: string
    group_id: string
    chunks_indexed: number
  }
  error?: string
}

type ChatResult = {
  text: string
  filename?: string
  page?: number
  group_id?: string
  score?: number
}

type ChatResponse = {
  query: string
  group_id: string
  results: ChatResult[]
}

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  results?: ChatResult[]
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

function resultText(results: ChatResult[]) {
  if (results.length === 0) {
    return "No matching context found."
  }

  return results.map((result) => result.text).join("\n\n")
}

export function App() {
  const [groupId, setGroupId] = React.useState("demo")
  const [file, setFile] = React.useState<File | null>(null)
  const [taskId, setTaskId] = React.useState<string | null>(null)
  const [taskStatus, setTaskStatus] = React.useState<TaskStatus | null>(null)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [chatError, setChatError] = React.useState<string | null>(null)
  const [isChatting, setIsChatting] = React.useState(false)

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
          limit: 5,
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
          content: resultText(body.results),
          results: body.results,
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
                {taskStatus.result.filename}.
              </p>
            ) : null}
            {taskStatus?.error || uploadError ? (
              <p className="text-sm text-destructive">
                {taskStatus?.error ?? uploadError}
              </p>
            ) : null}
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
                  <p className="whitespace-pre-wrap break-words leading-6">
                    {message.content}
                  </p>
                  {message.results?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.results.map((result, index) => (
                        <span
                          key={`${message.id}-${index}`}
                          className="rounded-sm border px-2 py-1 text-xs text-muted-foreground"
                        >
                          {result.filename ?? "source"}
                          {result.page ? ` p.${result.page}` : ""}
                        </span>
                      ))}
                    </div>
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
