import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type ConversationListSkeletonProps = {
  count?: number
}

export function ConversationListSkeleton({
  count = 3,
}: ConversationListSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="flex items-center justify-between rounded-md px-2 py-1.5"
          aria-hidden="true"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Skeleton className="size-3.5 shrink-0 rounded-sm" />
            <Skeleton className="h-3.5 flex-1" />
          </div>
          <Skeleton className="size-6 shrink-0 rounded-md" />
        </div>
      ))}
    </>
  )
}

type IndexedFilesTableSkeletonProps = {
  rows?: number
}

export function IndexedFilesTableSkeleton({
  rows = 4,
}: IndexedFilesTableSkeletonProps) {
  return (
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
              <TableHead className="sticky top-0 z-10 bg-card">File</TableHead>
              <TableHead className="sticky top-0 z-10 w-16 bg-card">
                Chunks
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-20 bg-card text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, index) => (
              <TableRow key={index} aria-hidden="true">
                <TableCell className="max-w-0">
                  <Skeleton className="h-4 w-full max-w-[160px]" />
                </TableCell>
                <TableCell className="w-16">
                  <Skeleton className="h-3.5 w-14" />
                </TableCell>
                <TableCell className="w-20 text-right">
                  <Skeleton className="ml-auto size-9 rounded-md" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
    </ScrollArea>
  )
}
