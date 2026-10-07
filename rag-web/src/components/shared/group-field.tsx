import * as React from "react"
import { Plus } from "lucide-react"

import { useGroup } from "@/context/group-context"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { GROUP_ID_REGEX } from "@/lib/api"
import { showSuccessToast } from "@/lib/toast"

type GroupFieldProps = {
  id?: string
  value?: string
  onChange?: (value: string) => void
  label?: string
  className?: string
}

export function GroupField({
  id = "group-select",
  value,
  onChange,
  label = "Group",
  className,
}: GroupFieldProps) {
  const {
    groupId: contextGroupId,
    setGroupId: contextSetGroupId,
    groups,
    createGroup,
  } = useGroup()

  const activeValue = value ?? contextGroupId
  const setActiveValue = onChange ?? contextSetGroupId

  const [isCreateOpen, setIsCreateOpen] = React.useState(false)
  const [newGroupName, setNewGroupName] = React.useState("")
  const [createError, setCreateError] = React.useState<string | null>(null)

  const handleSelectChange = (val: string) => {
    setActiveValue(val)
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const cleanName = newGroupName.trim()

    if (!cleanName) {
      setCreateError("Group name is required.")
      return
    }

    if (!GROUP_ID_REGEX.test(cleanName)) {
      setCreateError(
        "Only letters, numbers, underscores, dots, and hyphens are allowed."
      )
      return
    }

    const created = createGroup(cleanName)
    if (created) {
      setActiveValue(cleanName)
      showSuccessToast("Group created", {
        description: `Active group set to "${cleanName}".`,
      })
      setNewGroupName("")
      setCreateError(null)
      setIsCreateOpen(false)
    } else {
      setCreateError("Failed to create group. Invalid name.")
    }
  }

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Select value={activeValue} onValueChange={handleSelectChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Select a group..." />
          </SelectTrigger>
          <SelectContent
            position="popper"
            align="start"
            className="min-w-60 w-[var(--radix-select-trigger-width)]"
          >
            <SelectGroup>
              <SelectLabel>Available groups</SelectLabel>
              {groups.map((group) => (
                <SelectItem key={group.group_id} value={group.group_id}>
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className="truncate font-medium">
                      {group.group_id}
                    </span>
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                      {group.files > 0
                        ? `${group.files} ${group.files === 1 ? "file" : "files"}`
                        : "0 files"}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-9 shrink-0"
              aria-label="Create new group"
              onClick={() => {
                setCreateError(null)
                setIsCreateOpen(true)
              }}
            >
              <Plus className="size-4 shrink-0" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Create new group</TooltipContent>
        </Tooltip>
      </div>

      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open)
          if (!open) {
            setCreateError(null)
            setNewGroupName("")
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create new group</DialogTitle>
            <DialogDescription>
              Enter a group identifier for organizing your documents.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-group-name">
                Group name <span aria-hidden="true">*</span>
              </Label>
              <Input
                id="new-group-name"
                value={newGroupName}
                onChange={(e) => {
                  setNewGroupName(e.target.value)
                  setCreateError(null)
                }}
                placeholder="e.g. project-documents"
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground">
                Letters, numbers, underscores, dots, and hyphens are supported.
              </p>
              {createError ? (
                <p className="text-xs text-destructive">{createError}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCreateOpen(false)
                  setCreateError(null)
                  setNewGroupName("")
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Create group</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
