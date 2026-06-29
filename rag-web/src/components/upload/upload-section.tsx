import * as React from "react"
import {
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react"

import { GroupField } from "@/components/shared/group-field"
import { IndexedFilesTableSkeleton } from "@/components/shared/loading-skeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { API_BASE_URL, DONE_STATES, GROUP_ID_REGEX, readError } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { showErrorToast, showInfoToast, showSuccessToast } from "@/lib/toast"
import type { FileSummary, GroupSummary, TaskStatus } from "@/lib/types"

export function UploadSection() {
  const [groupId, setGroupId] = React.useState("demo")
  const [file, setFile] = React.useState<File | null>(null)
  const [taskId, setTaskId] = React.useState<string | null>(null)
  const [taskStatus, setTaskStatus] = React.useState<TaskStatus | null>(null)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [groupSummary, setGroupSummary] = React.useState<GroupSummary | null>(null)
  const [indexedFiles, setIndexedFiles] = React.useState<FileSummary[]>([])
  const [managementError, setManagementError] = React.useState<string | null>(null)
  const [isRefreshingGroup, setIsRefreshingGroup] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<
    { kind: "file"; fileSummary: FileSummary } | { kind: "group" } | null
  >(null)

  const refreshGroup = React.useCallback(async () => {
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
      const message = error instanceof Error ? error.message : String(error)
      setManagementError(message)
      showErrorToast("Failed to load group", { description: message })
    } finally {
      setIsRefreshingGroup(false)
    }
  }, [groupId])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => void refreshGroup(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [refreshGroup])

  React.useEffect(() => {
    if (!taskId) return undefined

    let cancelled = false
    let timeoutId: number | undefined

    async function poll() {
      try {
        const response = await fetch(`${API_BASE_URL}/status/${taskId}`)
        if (!response.ok) throw new Error(await readError(response))

        const status = (await response.json()) as TaskStatus
        if (cancelled) return

        setTaskStatus(status)
        if (!DONE_STATES.has(status.state)) {
          timeoutId = window.setTimeout(poll, 1500)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setUploadError(message)
          showErrorToast("Upload status check failed", { description: message })
        }
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [taskId])

  React.useEffect(() => {
    if (taskStatus?.state === "SUCCESS") {
      showSuccessToast("File indexed", {
        description: `${taskStatus.result?.chunks_indexed ?? 0} chunks from ${taskStatus.result?.filename ?? "file"}.`,
      })
      const timeoutId = window.setTimeout(() => void refreshGroup(), 0)
      return () => window.clearTimeout(timeoutId)
    }
    return undefined
  }, [refreshGroup, taskStatus?.state, taskStatus?.result])

  function pickFile(nextFile: File | undefined) {
    setUploadError(null)
    if (!nextFile) return

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
      if (!response.ok) throw new Error(await readError(response))

      const body = (await response.json()) as { task_id: string }
      setTaskId(body.task_id)
      setTaskStatus({ task_id: body.task_id, state: "PENDING" })
      showInfoToast("Upload started")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setUploadError(message)
      showErrorToast("Upload failed", { description: message })
    } finally {
      setIsUploading(false)
    }
  }

  async function confirmDeleteFile() {
    if (deleteTarget?.kind !== "file") return
    const { fileSummary } = deleteTarget
    setDeleteTarget(null)
    setManagementError(null)
    try {
      const response = await fetch(
        `${API_BASE_URL}/groups/${encodeURIComponent(fileSummary.group_id)}/files/${encodeURIComponent(fileSummary.file_id)}`,
        { method: "DELETE" }
      )
      if (!response.ok) throw new Error(await readError(response))
      showSuccessToast("File deleted")
      await refreshGroup()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setManagementError(message)
      showErrorToast("Failed to delete file", { description: message })
    }
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
        { method: "DELETE" }
      )
      if (!response.ok) throw new Error(await readError(response))
      setGroupSummary(null)
      setIndexedFiles([])
      showSuccessToast("Group deleted")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setManagementError(message)
      showErrorToast("Failed to delete group", { description: message })
    }
  }

  const statusState = taskStatus?.state ?? "IDLE"

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-sm">
        <GroupField id="upload-group" value={groupId} onChange={setGroupId} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upload PDF</CardTitle>
            <CardDescription>Index a document into the selected group.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form className="flex flex-col gap-4" onSubmit={handleUpload}>
              <label
                className="flex aspect-[16/9] cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-muted/40 p-6 text-center transition hover:bg-muted"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
              >
                <input
                  className="sr-only"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => pickFile(event.target.files?.[0])}
                />
                <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Upload className="size-5 shrink-0" aria-hidden="true" />
                </span>
                <span className="max-w-full truncate text-sm font-medium">
                  {file ? file.name : "Drop PDF or browse"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {file ? formatBytes(file.size) : "PDF only"}
                </span>
              </label>

              <Button type="submit" disabled={isUploading || !file}>
                {isUploading ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="size-4 shrink-0" aria-hidden="true" />
                )}
                Upload
              </Button>
            </form>

            {(taskId || uploadError || taskStatus?.error) && (
              <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  {statusState === "SUCCESS" ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  ) : statusState === "FAILURE" || statusState === "REVOKED" ? (
                    <XCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                  ) : taskId ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
                  ) : (
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <Badge variant="secondary">{statusState}</Badge>
                </div>
                {taskStatus?.result ? (
                  <p className="text-sm text-muted-foreground">
                    {taskStatus.result.chunks_indexed} chunks from {taskStatus.result.filename}
                  </p>
                ) : null}
                {taskStatus?.error || uploadError ? (
                  <p className="text-sm text-destructive">{taskStatus?.error ?? uploadError}</p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col">
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                Indexed files
              </CardTitle>
              {isRefreshingGroup && !groupSummary ? (
                <CardDescription aria-hidden="true">
                  <Skeleton className="h-4 w-44" />
                </CardDescription>
              ) : groupSummary ? (
                <CardDescription>
                  {groupSummary.files} files, {groupSummary.chunks} chunks
                </CardDescription>
              ) : (
                <CardDescription>No data for this group.</CardDescription>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  type="button"
                  aria-label="Refresh group"
                  onClick={() => void refreshGroup()}
                  disabled={isRefreshingGroup}
                >
                  {isRefreshingGroup ? (
                    <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="size-4 shrink-0" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
            {isRefreshingGroup && indexedFiles.length === 0 ? (
              <IndexedFilesTableSkeleton rows={4} />
            ) : indexedFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <FileText className="size-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium">No files indexed</p>
                <p className="text-xs text-muted-foreground">Upload a PDF to get started.</p>
              </div>
            ) : (
              <ScrollArea className="max-h-[360px]">
                <div className="overflow-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>File</TableHead>
                        <TableHead>Chunks</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {indexedFiles.map((item) => (
                        <TableRow key={item.file_id}>
                          <TableCell className="max-w-[200px] font-medium">
                            <span className="truncate">{item.filename}</span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {item.chunks}
                            {item.pages.length ? ` · ${item.pages.length}p` : ""}
                          </TableCell>
                          <TableCell className="text-right">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  type="button"
                                  aria-label={`Delete ${item.filename}`}
                                  onClick={() => setDeleteTarget({ kind: "file", fileSummary: item })}
                                >
                                  <Trash2 className="size-4 shrink-0" aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete file</TooltipContent>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            )}

            {groupSummary ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="self-start"
                onClick={() => setDeleteTarget({ kind: "group" })}
              >
                <Trash2 className="size-4 shrink-0" aria-hidden="true" />
                Delete group
              </Button>
            ) : null}

            {managementError ? (
              <p className="text-sm text-destructive">{managementError}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTarget?.kind === "file" ? "Delete file" : "Delete group"}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.kind === "file"
                ? `Permanently delete embeddings for ${deleteTarget.fileSummary.filename}?`
                : `Permanently delete all embeddings for group ${groupId.trim()}?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget?.kind === "file") void confirmDeleteFile()
                else void confirmDeleteGroup()
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
