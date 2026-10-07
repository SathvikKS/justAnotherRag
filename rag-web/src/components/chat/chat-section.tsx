import * as React from "react"
import {
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Settings,
  Trash2,
} from "lucide-react"

import { GroupField } from "@/components/shared/group-field"
import { highlightMatches } from "@/components/shared/highlight-matches"
import { AssistantRichText } from "@/components/chat/assistant-rich-text"
import { useGroup } from "@/context/group-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Bubble, Message } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerItem,
} from "@/components/ui/message-scroller"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ConversationListSkeleton } from "@/components/shared/loading-skeletons"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { API_BASE_URL, GROUP_ID_REGEX, readError } from "@/lib/api"
import { formatScore, makeId } from "@/lib/format"
import { showErrorToast } from "@/lib/toast"
import type {
  ChatMessage,
  ChatResponse,
  ChatSession,
  ChunkDetail,
  DebugSearchResponse,
  QueryMode,
  Source,
} from "@/lib/types"

type ChatSectionProps = {
  token: string
}

export function ChatSection({ token }: ChatSectionProps) {
  const { groupId, setGroupId } = useGroup()
  const [sessions, setSessions] = React.useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = React.useState<string | null>(
    null
  )
  const [sessionsLoading, setSessionsLoading] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [queryMode, setQueryMode] = React.useState<QueryMode>("chat")
  const [sourceLimit, setSourceLimit] = React.useState(5)
  const [expandQuery, setExpandQuery] = React.useState(true)
  const [requireCitations, setRequireCitations] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [searchResults, setSearchResults] = React.useState<Source[]>([])
  const [searchQuery, setSearchQuery] = React.useState("")
  const [chatError, setChatError] = React.useState<string | null>(null)
  const [isChatting, setIsChatting] = React.useState(false)
  const [lastQuery, setLastQuery] = React.useState("")
  const [expandedChunks, setExpandedChunks] = React.useState<
    Map<string, ChunkDetail>
  >(new Map())
  const [loadingChunks, setLoadingChunks] = React.useState<Set<string>>(
    new Set()
  )

  const createSession = React.useCallback(
    async (title?: string) => {
      try {
        const res = await fetch(`${API_BASE_URL}/chat/sessions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title: title || "New chat" }),
        })
        if (!res.ok) throw new Error(await readError(res))
        const data = (await res.json()) as ChatSession
        setSessions((current) => [data, ...current])
        setCurrentSessionId(data.id)
        setMessages([])
        return data.id
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        showErrorToast("Failed to create conversation", {
          description: message,
        })
        return undefined
      }
    },
    [token]
  )

  const fetchSessions = React.useCallback(
    async (selectedId?: string) => {
      setSessionsLoading(true)
      try {
        const res = await fetch(`${API_BASE_URL}/chat/sessions`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(await readError(res))
        const data = (await res.json()) as ChatSession[]
        setSessions(data)

        if (data.length > 0) {
          if (selectedId && data.some((s) => s.id === selectedId)) {
            setCurrentSessionId(selectedId)
          } else if (
            !currentSessionId ||
            !data.some((s) => s.id === currentSessionId)
          ) {
            setCurrentSessionId(data[0].id)
          }
        } else {
          await createSession("New conversation")
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        showErrorToast("Failed to load conversations", { description: message })
      } finally {
        setSessionsLoading(false)
      }
    },
    [token, currentSessionId, createSession]
  )

  const deleteSession = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await fetch(`${API_BASE_URL}/chat/sessions/${sid}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(await readError(res))

      const remaining = sessions.filter((s) => s.id !== sid)
      setSessions(remaining)
      if (currentSessionId === sid) {
        if (remaining.length > 0) {
          setCurrentSessionId(remaining[0].id)
        } else {
          setCurrentSessionId(null)
          setMessages([])
          await createSession("New conversation")
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showErrorToast("Failed to delete conversation", { description: message })
    }
  }

  const loadMessages = React.useCallback(
    async (sid: string) => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/chat/sessions/${sid}/messages`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        )
        if (!res.ok) throw new Error(await readError(res))
        const data = (await res.json()) as ChatMessage[]
        setMessages(data)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        showErrorToast("Failed to load messages", { description: message })
      }
    },
    [token]
  )

  React.useEffect(() => {
    if (currentSessionId) void loadMessages(currentSessionId)
  }, [currentSessionId, loadMessages])

  React.useEffect(() => {
    void fetchSessions()
  }, [token])

  async function loadFullChunk(chunkId: string) {
    if (expandedChunks.has(chunkId) || loadingChunks.has(chunkId)) return
    setLoadingChunks((prev) => new Set(prev).add(chunkId))
    try {
      const params = new URLSearchParams()
      if (lastQuery) params.set("q", lastQuery)
      const url = `${API_BASE_URL}/chunks/${encodeURIComponent(chunkId)}${params.toString() ? "?" + params.toString() : ""}`
      const response = await fetch(url)
      if (!response.ok) throw new Error(await readError(response))
      const detail = (await response.json()) as ChunkDetail
      setExpandedChunks((prev) => {
        const next = new Map(prev)
        next.set(chunkId, detail)
        return next
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showErrorToast("Failed to load chunk", { description: message })
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

  async function handleChat(event: React.FormEvent) {
    event.preventDefault()
    const cleanQuery = query.trim()
    const cleanGroupId = groupId.trim()

    if (!cleanQuery) return

    if (!GROUP_ID_REGEX.test(cleanGroupId)) {
      setChatError(
        `Set a valid group id before ${queryMode === "chat" ? "chatting" : "searching"}.`
      )
      return
    }

    let activeSessionId = currentSessionId
    if (queryMode === "chat") {
      if (!activeSessionId) {
        activeSessionId = (await createSession(cleanQuery.slice(0, 30))) ?? null
        if (!activeSessionId) return
      }

      setMessages((current) => [
        ...current,
        { id: makeId(), role: "user", content: cleanQuery },
      ])
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
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query: cleanQuery,
            group_id: cleanGroupId,
            limit: sourceLimit,
          }),
        })
        if (!response.ok) throw new Error(await readError(response))

        const body = (await response.json()) as DebugSearchResponse
        setSearchQuery(body.query)
        setSearchResults(body.results)
        return
      }

      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: cleanQuery,
          group_id: cleanGroupId,
          limit: sourceLimit,
          expand_query: expandQuery,
          require_citations: requireCitations,
          session_id: activeSessionId,
        }),
      })
      if (!response.ok) throw new Error(await readError(response))

      const body = (await response.json()) as ChatResponse
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          content: body.answer,
          sources: body.sources,
          grounding: body.grounding,
          metrics: body.metrics,
        },
      ])

      if (activeSessionId) void fetchSessions(activeSessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setChatError(message)
      showErrorToast("Query failed", { description: message })
    } finally {
      setIsChatting(false)
    }
  }

  function renderSourceCard(result: Source, index: number, keyPrefix: string) {
    const snippet = result.snippet
    const chunkId = result.chunk_id
    const isExpanded = chunkId ? expandedChunks.has(chunkId) : false
    const isLoading = chunkId ? loadingChunks.has(chunkId) : false
    const full = chunkId ? expandedChunks.get(chunkId) : undefined

    return (
      <article
        key={`${keyPrefix}-${result.chunk_id ?? result.file_id ?? index}`}
        className="rounded-md border bg-background p-3 text-sm"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2 font-medium">
          <span>
            [{index + 1}] {result.filename ?? "source"}
            {result.page ? ` p.${result.page}` : ""}
          </span>
          <Badge variant="outline">score {formatScore(result.score)}</Badge>
        </div>
        {snippet ? (
          <div>
            <p className="leading-6 break-words whitespace-pre-wrap text-muted-foreground">
              {highlightMatches(snippet.text, snippet.match_positions)}
              {snippet.full_length > snippet.text.length ? "..." : null}
            </p>
            {chunkId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 h-7 px-2 text-xs"
                disabled={isLoading}
                onClick={() =>
                  isExpanded
                    ? collapseChunk(chunkId)
                    : void loadFullChunk(chunkId)
                }
              >
                {isLoading
                  ? "Loading..."
                  : isExpanded
                    ? "Hide full chunk"
                    : "Show full chunk"}
              </Button>
            ) : null}
            {isExpanded && full ? (
              <div className="mt-2 rounded-md border bg-muted/30 p-2 text-xs leading-6 break-words whitespace-pre-wrap">
                {highlightMatches(full.text, full.match_positions ?? [])}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            No snippet available
          </p>
        )}
      </article>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-3 rounded-md border bg-card p-4 lg:w-56">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Conversations</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="size-8"
                aria-label="New conversation"
                onClick={() => void createSession("New chat")}
              >
                <Plus className="size-4 shrink-0" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New conversation</TooltipContent>
          </Tooltip>
        </div>

        <ScrollArea className="max-h-48 lg:max-h-none lg:flex-1">
          <div className="flex flex-col gap-1">
            {sessionsLoading && sessions.length === 0 ? (
              <ConversationListSkeleton count={3} />
            ) : sessions.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No conversations yet.
              </p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setCurrentSessionId(s.id)}
                  className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition ${
                    currentSessionId === s.id
                      ? "bg-primary font-medium text-primary-foreground"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <MessageSquare
                      className="size-3.5 shrink-0 opacity-70"
                      aria-hidden="true"
                    />
                    <span className="truncate">{s.title}</span>
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    type="button"
                    className="size-6 opacity-0 group-hover:opacity-100"
                    aria-label="Delete conversation"
                    onClick={(e) => void deleteSession(s.id, e)}
                  >
                    <Trash2 className="size-3" aria-hidden="true" />
                  </Button>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3 sm:max-w-xs">
            <GroupField id="chat-group" value={groupId} onChange={setGroupId} />
          </div>

          <div className="flex items-center gap-2">
            <Tabs
              value={queryMode}
              onValueChange={(v) => setQueryMode(v as QueryMode)}
            >
              <TabsList>
                <TabsTrigger value="chat">Ask AI</TabsTrigger>
                <TabsTrigger value="search">Search</TabsTrigger>
              </TabsList>
            </Tabs>

            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Query settings"
                >
                  <Settings className="size-4 shrink-0" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="flex flex-col gap-6">
                <SheetHeader>
                  <SheetTitle>Query settings</SheetTitle>
                  <SheetDescription>
                    Retrieval, query expansion, and citation options.
                  </SheetDescription>
                </SheetHeader>
                <div className="flex flex-col gap-6 px-6">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span>Sources to retrieve</span>
                      <span className="text-muted-foreground tabular-nums">
                        {sourceLimit}
                      </span>
                    </div>
                    <Slider
                      value={[sourceLimit]}
                      onValueChange={([value]) => setSourceLimit(value)}
                      min={1}
                      max={20}
                      step={1}
                    />
                    <span className="text-xs text-muted-foreground">
                      {expandQuery
                        ? `Per question; up to ${sourceLimit * 5} candidates before deduplication`
                        : "Per query"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        Generate search questions
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Find more relevant sources for each answer
                      </span>
                    </div>
                    <Switch
                      checked={expandQuery}
                      disabled={queryMode === "search"}
                      onCheckedChange={setExpandQuery}
                      aria-label="Generate search questions"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        Require citations
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Reject uncited answers
                      </span>
                    </div>
                    <Switch
                      checked={requireCitations}
                      disabled={queryMode === "search"}
                      onCheckedChange={setRequireCitations}
                    />
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {queryMode === "search" ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-4 p-4">
              {searchResults.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed text-center text-sm text-muted-foreground">
                  Search the selected group to inspect retrieval hits.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-medium">
                    {searchResults.length} results for &ldquo;{searchQuery}
                    &rdquo;
                  </p>
                  {searchResults.map((result, index) =>
                    renderSourceCard(result, index, "search")
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        ) : (
          <MessageScroller
            sessionKey={currentSessionId ?? "new"}
            className="min-h-0 flex-1"
          >
            {messages.length === 0 ? (
              <div className="flex min-h-40 items-center justify-center border-b text-center text-sm text-muted-foreground">
                Ask a question about your indexed documents.
              </div>
            ) : (
              messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                  className="w-full"
                >
                  <Message
                    align={message.role === "user" ? "end" : "start"}
                    className="w-full"
                  >
                    <Bubble
                      className={
                        message.role === "user"
                          ? "max-w-[82%] break-words bg-primary p-3 text-sm text-primary-foreground"
                          : "max-w-[88%] break-words border bg-background p-3 text-sm"
                      }
                    >
                      {message.role === "assistant" && message.grounding ? (
                        <div className="mb-2">
                          <Badge
                            variant={
                              message.grounding.status === "cited"
                                ? "default"
                                : message.grounding.status ===
                                    "rejected_uncited"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {message.grounding.status === "cited"
                              ? `Cited: ${message.grounding.citations_found.join(", ")}`
                              : message.grounding.status ===
                                  "rejected_uncited"
                                ? "Uncited: rejected"
                                : message.grounding.status === "uncited"
                                  ? "Uncited"
                                  : message.sources?.length
                                    ? `${message.sources.length} sources`
                                    : "No sources"}
                          </Badge>
                        </div>
                      ) : null}
                      {message.role === "assistant" ? (
                        <AssistantRichText content={message.content} />
                      ) : (
                        <p className="leading-6 break-words whitespace-pre-wrap">
                          {message.content}
                        </p>
                      )}
                      {message.role === "assistant" && message.metrics ? (
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">
                            {message.metrics.session_tps.toFixed(1)} tok/s
                          </Badge>
                          <Badge variant="outline">
                            {message.metrics.prompt_tokens} prompt
                          </Badge>
                          <Badge variant="outline">
                            {message.metrics.completion_tokens} completion
                          </Badge>
                          <Badge variant="outline">
                            {message.metrics.total_context_used} total
                          </Badge>
                        </div>
                      ) : null}
                      {message.sources?.length ? (
                        <details className="mt-3 rounded-md border bg-muted/30 p-2">
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                            Show evidence ({message.sources.length})
                          </summary>
                          <div className="mt-2 flex flex-col gap-2">
                            {message.sources.map((result, index) =>
                              renderSourceCard(result, index, message.id)
                            )}
                          </div>
                        </details>
                      ) : null}
                    </Bubble>
                  </Message>
                </MessageScrollerItem>
              ))
            )}
          </MessageScroller>
        )}

        <form className="border-t p-4" onSubmit={handleChat}>
          {chatError ? (
            <p className="mb-2 text-sm text-destructive">{chatError}</p>
          ) : null}
          <div className="flex gap-2">
            <Textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                queryMode === "chat"
                  ? "Ask about your documents..."
                  : "Search indexed chunks..."
              }
              rows={1}
              className="min-h-10 resize-none"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void handleChat(event)
                }
              }}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  type="submit"
                  disabled={isChatting}
                  aria-label="Send"
                >
                  {isChatting ? (
                    <Loader2
                      className="size-4 shrink-0 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Send className="size-4 shrink-0" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Send</TooltipContent>
            </Tooltip>
          </div>
        </form>
      </div>
    </div>
  )
}
