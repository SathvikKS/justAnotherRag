const responseKeys = new Set([
  "answer",
  "citations",
  "insufficient",
  "query",
  "group_id",
  "sources",
  "grounding",
  "metrics",
])

/** Unwraps only the exact structured response envelope returned by the LLM. */
export function normalizeAssistantContent(content: string): string {
  const trimmed = content.trim()
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return content

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return content
    }

    const envelope = parsed as Record<string, unknown>
    const keys = Object.keys(envelope)
    if (
      !keys.includes("answer") ||
      keys.some((key) => !responseKeys.has(key)) ||
      typeof envelope.answer !== "string"
    ) {
      return content
    }
    return envelope.answer
  } catch {
    return content
  }
}
