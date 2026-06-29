import * as React from "react"

export function highlightMatches(text: string, positions: number[][]): React.ReactNode {
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
    parts.push(
      <mark key={i} className="rounded-sm bg-amber-500/25 px-0.5 text-foreground">
        {text.slice(start, end)}
      </mark>
    )
    cursor = end
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }
  return <>{parts}</>
}
