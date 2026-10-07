/* eslint-disable react-refresh/only-export-components */
import * as React from "react"

import { API_BASE_URL, GROUP_ID_REGEX, readError } from "@/lib/api"
import { showErrorToast } from "@/lib/toast"
import type { GroupSummary } from "@/lib/types"

const STORAGE_KEY_SELECTED_GROUP = "rag_selected_group_id"
const STORAGE_KEY_CUSTOM_GROUPS = "rag_custom_groups"

interface GroupContextValue {
  groupId: string
  setGroupId: (id: string) => void
  groups: GroupSummary[]
  isLoading: boolean
  refreshGroups: () => Promise<void>
  createGroup: (newGroupId: string) => boolean
  removeGroup: (deletedGroupId: string) => void
}

const GroupContext = React.createContext<GroupContextValue | null>(null)

function getStoredCustomGroups(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_GROUPS)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string")
    }
  } catch {
    // Ignore JSON parse errors
  }
  return []
}

function saveStoredCustomGroups(groups: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOM_GROUPS, JSON.stringify(groups))
  } catch {
    // Ignore localStorage write errors
  }
}

export function GroupProvider({ children }: { children: React.ReactNode }) {
  const [groupId, setGroupIdState] = React.useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_SELECTED_GROUP) || "demo"
  })

  const [serverGroups, setServerGroups] = React.useState<GroupSummary[]>([])
  const [customGroups, setCustomGroups] = React.useState<string[]>(
    getStoredCustomGroups
  )
  const [isLoading, setIsLoading] = React.useState(false)
  const initialLoadDoneRef = React.useRef(false)

  const setGroupId = React.useCallback((nextId: string) => {
    const cleanId = nextId.trim()
    setGroupIdState(cleanId)
    try {
      localStorage.setItem(STORAGE_KEY_SELECTED_GROUP, cleanId)
    } catch {
      // Ignore localStorage write errors
    }
  }, [])

  const refreshGroups = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/groups`)
      if (!response.ok) {
        throw new Error(await readError(response))
      }
      const data = (await response.json()) as GroupSummary[]
      setServerGroups(data)

      // If user has not explicitly set a group in localStorage yet,
      // and server returns groups, default to the first server group
      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true
        const stored = localStorage.getItem(STORAGE_KEY_SELECTED_GROUP)
        if (!stored && data.length > 0) {
          setGroupId(data[0].group_id)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showErrorToast("Failed to fetch available groups", {
        description: message,
      })
    } finally {
      setIsLoading(false)
    }
  }, [setGroupId])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => void refreshGroups(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [refreshGroups])

  const createGroup = React.useCallback(
    (newGroupId: string): boolean => {
      const cleanId = newGroupId.trim()
      if (!GROUP_ID_REGEX.test(cleanId)) {
        return false
      }

      setCustomGroups((prev) => {
        if (prev.includes(cleanId)) return prev
        const next = [...prev, cleanId]
        saveStoredCustomGroups(next)
        return next
      })

      setGroupId(cleanId)
      return true
    },
    [setGroupId]
  )

  const removeGroup = React.useCallback(
    (deletedGroupId: string) => {
      const cleanId = deletedGroupId.trim()
      setCustomGroups((prev) => {
        const next = prev.filter((g) => g !== cleanId)
        saveStoredCustomGroups(next)
        return next
      })

      setServerGroups((prev) => prev.filter((g) => g.group_id !== cleanId))

      // If the currently selected group was deleted, switch to another group
      if (groupId === cleanId) {
        const remaining = serverGroups
          .filter((g) => g.group_id !== cleanId)
          .map((g) => g.group_id)
          .concat(customGroups.filter((g) => g !== cleanId))

        const nextSelection = remaining.length > 0 ? remaining[0] : "demo"
        setGroupId(nextSelection)
      }
    },
    [groupId, serverGroups, customGroups, setGroupId]
  )

  // Merge server groups with custom groups and make sure current groupId is included
  const groups = React.useMemo<GroupSummary[]>(() => {
    const map = new Map<string, GroupSummary>()

    for (const sg of serverGroups) {
      map.set(sg.group_id, sg)
    }

    for (const cg of customGroups) {
      if (!map.has(cg)) {
        map.set(cg, { group_id: cg, chunks: 0, files: 0 })
      }
    }

    if (groupId && !map.has(groupId)) {
      map.set(groupId, { group_id: groupId, chunks: 0, files: 0 })
    }

    return Array.from(map.values()).sort((a, b) =>
      a.group_id.localeCompare(b.group_id)
    )
  }, [serverGroups, customGroups, groupId])

  const value = React.useMemo<GroupContextValue>(
    () => ({
      groupId,
      setGroupId,
      groups,
      isLoading,
      refreshGroups,
      createGroup,
      removeGroup,
    }),
    [groupId, setGroupId, groups, isLoading, refreshGroups, createGroup, removeGroup]
  )

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>
}

export function useGroup(): GroupContextValue {
  const context = React.useContext(GroupContext)
  if (!context) {
    throw new Error("useGroup must be used within a GroupProvider")
  }
  return context
}
