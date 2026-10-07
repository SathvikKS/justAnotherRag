import ReactMarkdown, { type Components } from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import { parseFragment } from "parse5"
import { visit } from "unist-util-visit"
import type { Root } from "mdast"

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { normalizeAssistantContent } from "@/lib/assistant-content"

const tableTags = new Set([
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
])

type ParsedHtmlNode = {
  nodeName: string
  tagName?: string
  namespaceURI?: string
  value?: string
  childNodes?: ParsedHtmlNode[]
}

function isTableFragment(node: ParsedHtmlNode): boolean {
  const roots = (node.childNodes ?? []).filter(
    (child) => child.nodeName !== "#text" || Boolean(child.value?.trim())
  )
  if (roots.length !== 1 || roots[0].tagName !== "table") return false

  const isAllowedTableNode = (current: ParsedHtmlNode): boolean => {
    if (current.nodeName === "#text" || current.nodeName === "#comment") {
      return true
    }
    if (
      !current.tagName ||
      current.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      !tableTags.has(current.tagName)
    ) {
      return false
    }
    return (current.childNodes ?? []).every(isAllowedTableNode)
  }

  return isAllowedTableNode(roots[0])
}

/**
 * Raw HTML is accepted only when a parser confirms that the whole fragment is
 * one table tree. Everything else is converted back to ordinary text.
 */
function remarkTableOnlyHtml() {
  return (tree: Root) => {
    visit(tree, "html", (node, index, parent) => {
      if (index === undefined || !parent || !("children" in parent)) return
      const parsed = parseFragment(node.value) as unknown as ParsedHtmlNode
      if (!isTableFragment(parsed)) {
        parent.children[index] = { type: "text", value: node.value }
      }
    })
  }
}

const chatSanitizeSchema = {
  tagNames: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "ul",
    ...tableTags,
  ],
  attributes: {
    a: ["href", "title"],
    td: ["colSpan", "rowSpan"],
    th: ["colSpan", "rowSpan", "scope"],
  },
  protocols: {
    href: ["http", "https", "mailto", "tel"],
  },
}

const safeLink = (url: string) => {
  const trimmed = url.trim()
  const protocol = /^([a-z][a-z\d+.-]*):/i.exec(trimmed)?.[1].toLowerCase()
  return !protocol || ["http", "https", "mailto", "tel"].includes(protocol)
    ? trimmed
    : ""
}

const components: Components = {
  a: ({ href, children, ...props }) => (
    <a href={href ? safeLink(href) : undefined} {...props}>
      {children}
    </a>
  ),
  table: ({ children, ...props }) => <Table {...props}>{children}</Table>,
  caption: ({ children, ...props }) => (
    <TableCaption {...props}>{children}</TableCaption>
  ),
  thead: ({ children, ...props }) => (
    <TableHeader {...props}>{children}</TableHeader>
  ),
  tbody: ({ children, ...props }) => <TableBody {...props}>{children}</TableBody>,
  tfoot: ({ children, ...props }) => (
    <TableFooter {...props}>{children}</TableFooter>
  ),
  tr: ({ children, ...props }) => <TableRow {...props}>{children}</TableRow>,
  th: ({ children, ...props }) => <TableHead {...props}>{children}</TableHead>,
  td: ({ children, ...props }) => <TableCell {...props}>{children}</TableCell>,
}

export function AssistantRichText({ content }: { content: string }) {
  return (
    <div className="min-w-0 space-y-3 break-words text-sm leading-6 text-foreground [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-medium [&_li]:ml-5 [&_ol]:list-decimal [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkTableOnlyHtml]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, chatSanitizeSchema]]}
        components={components}
        urlTransform={safeLink}
      >
        {normalizeAssistantContent(content)}
      </ReactMarkdown>
    </div>
  )
}
