export type TaskStatus = {
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

export type Snippet = {
  text: string
  match_positions: number[][]
  full_length: number
}

export type Source = {
  snippet: Snippet | null
  chunk_id?: string
  file_id?: string
  filename?: string
  page?: number
  group_id?: string
  score?: number
}

export type ChunkDetail = {
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

export type GroupSummary = {
  group_id: string
  chunks: number
  files: number
  created_at?: string | null
}

export type FileSummary = {
  file_id: string
  filename: string
  group_id: string
  chunks: number
  pages: number[]
  created_at?: string | null
  legacy: boolean
}

export type Grounding = {
  mode: string
  sources_supplied: number
  citations_required: boolean
  citations_found: number[]
  status: string
  raw_answer?: string
}

export type ChatMetrics = {
  session_tps: number
  prompt_tokens: number
  completion_tokens: number
  total_context_used: number
}

export type ChatResponse = {
  query: string
  group_id: string
  answer: string
  completion_status: CompletionStatus
  sources: Source[]
  grounding: Grounding
  metrics?: ChatMetrics | null
}

export type DebugSearchResponse = {
  query: string
  group_id: string
  results: Source[]
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  completion_status?: CompletionStatus
  sources?: Source[]
  grounding?: Grounding
  metrics?: ChatMetrics | null
}

export type CompletionStatus =
  "complete" | "truncated" | "interrupted" | "invalid"

export type QueryMode = "chat" | "search"

export type ChatSession = {
  id: string
  title: string
  created_at: string
}
