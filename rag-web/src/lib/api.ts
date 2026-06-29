export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"
export const GROUP_ID_REGEX = /^[A-Za-z0-9_.-]+$/
export const DONE_STATES = new Set(["SUCCESS", "FAILURE", "REVOKED"])

export async function readError(response: Response) {
  try {
    const body = (await response.json()) as { detail?: unknown }
    return typeof body.detail === "string"
      ? body.detail
      : `${response.status} ${response.statusText}`
  } catch {
    return `${response.status} ${response.statusText}`
  }
}
