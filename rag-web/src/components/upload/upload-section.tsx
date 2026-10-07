import * as React from "react"
import {
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
  X,
} from "lucide-react"

import { GroupField } from "@/components/shared/group-field"
import { IndexedFilesTableSkeleton } from "@/components/shared/loading-skeletons"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import {
  Card,
  CardAction,
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
import { useGroup } from "@/context/group-context"
import { formatBytes } from "@/lib/format"
import { showErrorToast, showSuccessToast } from "@/lib/toast"
import type { FileSummary, GroupSummary, TaskStatus } from "@/lib/types"

export function UploadSection() {
  const {
    groupId,
    setGroupId,
    refreshGroups: refreshAllGroups,
    removeGroup,
  } = useGroup()
  interface UploadItem {
    id: string
    file: File
    taskId: string | null
    taskStatus: TaskStatus | null
    uploadError: string | null
    progress: number
    state: "idle" | "queued" | "uploading" | "processing" | "error" | "done"
  }

  const [uploadItems, setUploadItems] = React.useState<UploadItem[]>([])
  const uploadingItemIds = React.useRef<Set<string>>(new Set())
  const [groupSummary, setGroupSummary] = React.useState<GroupSummary | null>(
    null
  )
  const [indexedFiles, setIndexedFiles] = React.useState<FileSummary[]>([])
  const [managementError, setManagementError] = React.useState<string | null>(
    null
  )
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
        fetch(
          `${API_BASE_URL}/groups/${encodeURIComponent(cleanGroupId)}/files`
        ),
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

  const activeTaskIds = React.useMemo(() => {
    return uploadItems
      .filter(
        (item) =>
          item.taskId &&
          item.taskStatus &&
          !DONE_STATES.has(item.taskStatus.state)
      )
      .map((item) => `${item.id}:${item.taskId}`)
      .join(",")
  }, [uploadItems])

  React.useEffect(() => {
    if (!activeTaskIds) return undefined

    let cancelled = false
    let timeoutId: number | undefined

    const tasksToPoll = activeTaskIds.split(",").map((s) => {
      const [id, taskId] = s.split(":")
      return { id, taskId }
    })

    async function poll() {
      try {
        const results = await Promise.all(
          tasksToPoll.map(async (t) => {
            const response = await fetch(`${API_BASE_URL}/status/${t.taskId}`)
            if (!response.ok) throw new Error(await readError(response))
            const status = (await response.json()) as TaskStatus
            return { id: t.id, status }
          })
        )

        if (cancelled) return

        setUploadItems((prev) => {
          let updated = false
          const nextItems = prev.map((item) => {
            const result = results.find((r) => r.id === item.id)
            if (result) {
              const previousState = item.taskStatus?.state
              const nextState = result.status.state

              if (nextState === "SUCCESS" && previousState !== "SUCCESS") {
                showSuccessToast("File indexed", {
                  description: `${result.status.result?.chunks_indexed ?? 0} chunks from ${result.status.result?.filename ?? item.file.name}.`,
                })
                void refreshGroup()
                void refreshAllGroups()
              } else if (
                (nextState === "FAILURE" || nextState === "REVOKED") &&
                previousState !== "FAILURE" &&
                previousState !== "REVOKED"
              ) {
                showErrorToast(`Indexing failed for ${item.file.name}`, {
                  description: result.status.error ?? "Unknown error",
                })
              }

              return {
                ...item,
                state: nextState === "SUCCESS" ? ("done" as const) : item.state,
                taskStatus: result.status,
              }
            }
            return item
          })

          const filtered = nextItems.filter((item) => item.state !== "done")
          if (filtered.length !== prev.length) {
            updated = true
          } else {
            for (let i = 0; i < filtered.length; i++) {
              if (
                filtered[i].taskStatus?.state !== prev[i].taskStatus?.state ||
                filtered[i].state !== prev[i].state
              ) {
                updated = true
                break
              }
            }
          }

          return updated ? filtered : prev
        })

        timeoutId = window.setTimeout(poll, 1500)
      } catch {
        if (!cancelled) {
          timeoutId = window.setTimeout(poll, 2000)
        }
      }
    }

    timeoutId = window.setTimeout(poll, 1500)

    return () => {
      cancelled = true
      if (timeoutId) window.clearTimeout(timeoutId)
    }
  }, [activeTaskIds, refreshGroup, refreshAllGroups])

  const uploadSingleItem = React.useCallback(
    (item: UploadItem, cleanGroupId: string) => {
      setTimeout(() => {
        setUploadItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, state: "uploading", progress: 0 } : i
          )
        )
      }, 0)

      const formData = new FormData()
      formData.append("file", item.file)
      formData.append("group_id", cleanGroupId)

      const xhr = new XMLHttpRequest()
      xhr.open("POST", `${API_BASE_URL}/upload`)

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentage = Math.round((event.loaded / event.total) * 100)
          setUploadItems((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, progress: percentage } : i
            )
          )
        }
      }

      xhr.onload = async () => {
        uploadingItemIds.current.delete(item.id)
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const body = JSON.parse(xhr.responseText) as { task_id: string }
            setUploadItems((prev) =>
              prev.map((i) =>
                i.id === item.id
                  ? {
                      ...i,
                      state: "processing",
                      taskId: body.task_id,
                      taskStatus: { task_id: body.task_id, state: "PENDING" },
                    }
                  : i
              )
            )
          } catch {
            setUploadItems((prev) =>
              prev.map((i) =>
                i.id === item.id
                  ? {
                      ...i,
                      state: "error",
                      uploadError: "Failed to parse response",
                    }
                  : i
              )
            )
          }
        } else {
          let errorMsg = "Upload failed"
          try {
            const body = JSON.parse(xhr.responseText) as { detail?: string }
            errorMsg = body.detail ?? errorMsg
          } catch {
            errorMsg = xhr.statusText || errorMsg
          }
          setUploadItems((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? { ...i, state: "error", uploadError: errorMsg }
                : i
            )
          )
          showErrorToast(`Upload failed for ${item.file.name}`, {
            description: errorMsg,
          })
        }
      }

      xhr.onerror = () => {
        uploadingItemIds.current.delete(item.id)
        setUploadItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, state: "error", uploadError: "Network error occurred" }
              : i
          )
        )
        showErrorToast(`Upload failed for ${item.file.name}`, {
          description: "Network error occurred",
        })
      }

      xhr.send(formData)
    },
    []
  )

  React.useEffect(() => {
    const activeUploads = uploadItems.filter(
      (item) =>
        item.state === "uploading" || uploadingItemIds.current.has(item.id)
    )
    if (activeUploads.length < 5) {
      const nextQueued = uploadItems.find(
        (item) =>
          item.state === "queued" && !uploadingItemIds.current.has(item.id)
      )
      if (nextQueued) {
        uploadingItemIds.current.add(nextQueued.id)
        void uploadSingleItem(nextQueued, groupId.trim())
      }
    }
  }, [uploadItems, groupId, uploadSingleItem])

  function pickFiles(nextFiles: FileList | null) {
    if (!nextFiles) return
    const newItems: UploadItem[] = []
    for (let i = 0; i < nextFiles.length; i++) {
      const nextFile = nextFiles[i]
      if (!nextFile.name.toLowerCase().endsWith(".pdf")) {
        showErrorToast(`Skipped ${nextFile.name}`, {
          description: "Only PDF files are supported.",
        })
        continue
      }
      if (nextFile.size > 50 * 1024 * 1024) {
        showErrorToast(`Skipped ${nextFile.name}`, {
          description: "File size exceeds 50MB limit.",
        })
        continue
      }
      newItems.push({
        id: `${nextFile.name}-${nextFile.size}-${Date.now()}-${i}`,
        file: nextFile,
        taskId: null,
        taskStatus: null,
        uploadError: null,
        progress: 0,
        state: "idle",
      })
    }
    setUploadItems((prev) => [...prev, ...newItems])
  }

  function handleRemoveFile(itemId: string) {
    uploadingItemIds.current.delete(itemId)
    setUploadItems((prev) => prev.filter((item) => item.id !== itemId))
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    pickFiles(event.dataTransfer.files)
  }

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault()
    const cleanGroupId = groupId.trim()

    if (uploadItems.length === 0) {
      showErrorToast("No files selected", {
        description: "Please choose or drop PDFs first.",
      })
      return
    }

    if (!GROUP_ID_REGEX.test(cleanGroupId)) {
      showErrorToast("Invalid Group ID", {
        description: "Use letters, numbers, underscores, dots, or hyphens.",
      })
      return
    }

    uploadingItemIds.current.clear()

    // Queue all idle and error items for upload
    setUploadItems((prev) =>
      prev.map((item) =>
        item.state === "idle" || item.state === "error"
          ? {
              ...item,
              state: "queued",
              progress: 0,
              uploadError: null,
              taskId: null,
              taskStatus: null,
            }
          : item
      )
    )
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
      void refreshAllGroups()
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
      removeGroup(cleanGroupId)
      showSuccessToast("Group deleted")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setManagementError(message)
      showErrorToast("Failed to delete group", { description: message })
    }
  }

  const itemsToUpload = React.useMemo(() => {
    return uploadItems.filter((i) => i.state === "idle" || i.state === "error")
  }, [uploadItems])

  const isAnyUploading = React.useMemo(() => {
    return uploadItems.some(
      (i) => i.state === "uploading" || i.state === "queued"
    )
  }, [uploadItems])

  const queuedItems = uploadItems.filter(
    (i) => i.state === "idle" || i.state === "queued"
  )
  const uploadingItems = uploadItems.filter((i) => i.state === "uploading")
  const processingItems = uploadItems.filter((i) => i.state === "processing")
  const failedItems = uploadItems.filter((i) => i.state === "error")

  const pendingCount = queuedItems.length
  const uploadingCount = uploadingItems.length
  const indexingCount = processingItems.length

  function renderQueueItem(item: UploadItem) {
    let attachmentState:
      "idle" | "uploading" | "processing" | "error" | "done" = "idle"
    let attachmentDescription = `${formatBytes(item.file.size)} · Ready`

    if (item.state === "uploading") {
      attachmentState = "uploading"
      attachmentDescription = `${formatBytes(item.file.size)} · Uploading... ${item.progress}%`
    } else if (item.state === "processing") {
      attachmentState = "processing"
      attachmentDescription = `${formatBytes(item.file.size)} · Indexing (State: ${item.taskStatus?.state ?? "PENDING"})...`
    } else if (item.state === "error") {
      attachmentState = "error"
      attachmentDescription = `${formatBytes(item.file.size)} · Failed: ${item.uploadError ?? "Indexing failure"}`
    } else if (item.state === "queued") {
      attachmentState = "idle"
      attachmentDescription = `${formatBytes(item.file.size)} · Queued`
    }

    return (
      <div
        key={item.id}
        className="flex min-w-0 flex-col gap-2 rounded-xl border bg-muted/20 p-2.5"
      >
        <Attachment
          state={attachmentState}
          className="!grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden border-0 bg-transparent p-0"
        >
          <AttachmentMedia>
            {item.state === "uploading" || item.state === "processing" ? (
              <Loader2
                className="size-4 animate-spin text-primary"
                aria-hidden="true"
              />
            ) : item.state === "error" ? (
              <XCircle className="size-4 text-destructive" aria-hidden="true" />
            ) : (
              <FileText
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </AttachmentMedia>
          <AttachmentContent className="overflow-hidden">
            <AttachmentTitle
              className="text-sm font-medium"
              title={item.file.name}
            >
              {item.file.name}
            </AttachmentTitle>
            <AttachmentDescription className="text-xs">
              {attachmentDescription}
            </AttachmentDescription>
          </AttachmentContent>
          {(item.state === "idle" ||
            item.state === "queued" ||
            item.state === "error") && (
            <AttachmentActions>
              <AttachmentAction
                aria-label={`Remove ${item.file.name}`}
                type="button"
                onClick={() => handleRemoveFile(item.id)}
              >
                <X className="size-4" aria-hidden="true" />
              </AttachmentAction>
            </AttachmentActions>
          )}
        </Attachment>

        {item.state === "uploading" && (
          <div className="px-10">
            <Progress value={item.progress} className="h-1" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-sm">
        <GroupField id="upload-group" value={groupId} onChange={setGroupId} />
      </div>

      <div className="grid w-full gap-6 lg:grid-cols-3">
        <Card className="flex w-full min-w-0 flex-col">
          <CardHeader>
            <CardTitle>Upload PDFs</CardTitle>
            <CardDescription>
              Index documents into the selected group (Max 50MB per file).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form className="flex flex-col gap-4" onSubmit={handleUpload}>
              <label
                className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/40 p-3 text-center transition hover:bg-muted"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
              >
                <input
                  className="sr-only"
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={(event) => pickFiles(event.target.files)}
                />
                <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Upload className="size-3.5 shrink-0" aria-hidden="true" />
                </span>
                <span className="max-w-full truncate text-xs font-semibold">
                  Drop PDFs or browse
                </span>
                <span className="text-[10px] text-muted-foreground">
                  PDFs only (Max 50MB)
                </span>
              </label>

              <Button
                type="submit"
                disabled={isAnyUploading || itemsToUpload.length === 0}
              >
                {isAnyUploading ? (
                  <Loader2
                    className="size-4 shrink-0 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Upload className="size-4 shrink-0" aria-hidden="true" />
                )}
                Upload
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="flex min-h-0 w-full min-w-0 flex-col">
          <CardHeader>
            <CardTitle>Upload Queue</CardTitle>
            <CardDescription>
              {uploadItems.length === 0
                ? "Monitor active uploads and indexing."
                : `${uploadingCount} uploading · ${indexingCount} indexing · ${pendingCount} pending`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
            {uploadItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-muted-foreground">
                <Upload className="size-8 opacity-45" aria-hidden="true" />
                <p className="text-sm font-medium">Queue is empty</p>
                <p className="text-xs">
                  Choose or drag files above to queue them.
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-[380px] pr-2">
                <div className="flex min-w-0 flex-col gap-4">
                  {uploadingItems.length > 0 && (
                    <div className="flex min-w-0 flex-col gap-2">
                      <h3 className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                        Uploading ({uploadingItems.length})
                      </h3>
                      {uploadingItems.map((item) => renderQueueItem(item))}
                    </div>
                  )}

                  {processingItems.length > 0 && (
                    <div className="flex min-w-0 flex-col gap-2">
                      <h3 className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                        Processing ({processingItems.length})
                      </h3>
                      {processingItems.map((item) => renderQueueItem(item))}
                    </div>
                  )}

                  {queuedItems.length > 0 && (
                    <div className="flex min-w-0 flex-col gap-2">
                      <h3 className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
                        Queued / Selected ({queuedItems.length})
                      </h3>
                      {queuedItems.map((item) => renderQueueItem(item))}
                    </div>
                  )}

                  {failedItems.length > 0 && (
                    <div className="flex min-w-0 flex-col gap-2">
                      <h3 className="text-[10px] font-bold tracking-wider text-destructive/80 uppercase">
                        Failed ({failedItems.length})
                      </h3>
                      {failedItems.map((item) => renderQueueItem(item))}
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 w-full min-w-0 flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              Indexed files
            </CardTitle>
            {isRefreshingGroup && !groupSummary ? (
              <CardDescription className="col-span-2" aria-hidden="true">
                <Skeleton className="h-4 w-44" />
              </CardDescription>
            ) : groupSummary ? (
              <CardDescription className="col-span-2">
                {groupSummary.files} files, {groupSummary.chunks} chunks
              </CardDescription>
            ) : (
              <CardDescription className="col-span-2">
                No data for this group.
              </CardDescription>
            )}
            <CardAction className="row-span-1">
              <div className="flex items-center gap-2">
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
                        <Loader2
                          className="size-4 shrink-0 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <RefreshCw
                          className="size-4 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Refresh</TooltipContent>
                </Tooltip>
                {groupSummary ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteTarget({ kind: "group" })}
                  >
                    <Trash2 className="size-4 shrink-0" aria-hidden="true" />
                    Delete group
                  </Button>
                ) : null}
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
            {isRefreshingGroup && indexedFiles.length === 0 ? (
              <IndexedFilesTableSkeleton rows={4} />
            ) : indexedFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
                <FileText
                  className="size-8 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium">No files indexed</p>
                <p className="text-xs text-muted-foreground">
                  Upload a PDF to get started.
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-[360px]">
                <div className="rounded-md border border-border">
                  <table className="w-full table-fixed caption-bottom text-sm">
                    <colgroup>
                      <col />
                      <col className="w-16" />
                      <col className="w-20" />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky top-0 z-10 bg-card">
                          File
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 w-16 bg-card">
                          Chunks
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 w-20 bg-card text-right">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {indexedFiles.map((item) => (
                        <TableRow key={item.file_id}>
                          <TableCell className="max-w-0 font-medium">
                            <span
                              className="block truncate"
                              title={item.filename}
                            >
                              {item.filename}
                            </span>
                          </TableCell>
                          <TableCell className="w-16 text-xs text-muted-foreground tabular-nums">
                            {item.chunks}
                            {item.pages.length
                              ? ` · ${item.pages.length}p`
                              : ""}
                          </TableCell>
                          <TableCell className="w-20 text-right">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  type="button"
                                  aria-label={`Delete ${item.filename}`}
                                  onClick={() =>
                                    setDeleteTarget({
                                      kind: "file",
                                      fileSummary: item,
                                    })
                                  }
                                >
                                  <Trash2
                                    className="size-4 shrink-0"
                                    aria-hidden="true"
                                  />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete file</TooltipContent>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
              </ScrollArea>
            )}

            {managementError ? (
              <p className="text-sm text-destructive">{managementError}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
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
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
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
