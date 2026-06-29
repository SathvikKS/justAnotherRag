export function makeId() {
  return crypto.randomUUID()
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatScore(score: number | undefined) {
  return typeof score === "number" ? score.toFixed(3) : "unknown"
}
