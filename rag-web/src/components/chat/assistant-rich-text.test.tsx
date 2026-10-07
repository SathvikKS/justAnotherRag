import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { normalizeAssistantContent } from "@/lib/assistant-content"

import { AssistantRichText } from "./assistant-rich-text"

function render(content: string) {
  return renderToStaticMarkup(<AssistantRichText content={content} />)
}

describe("normalizeAssistantContent", () => {
  it("unwraps the exact LLM response envelope", () => {
    expect(
      normalizeAssistantContent(
        '{"answer":"## Answer","citations":[1,2],"insufficient":false}'
      )
    ).toBe("## Answer")
  })

  it("unwraps an answer-only response envelope", () => {
    expect(normalizeAssistantContent('{"answer":"<table>...</table>"}')).toBe(
      "<table>...</table>"
    )
  })

  it.each([
    '{"answer":"hello","citations":[],"insufficient":false,"extra":true}',
    '{"unrelated":"hello"}',
    'prefix {"answer":"hello","citations":[],"insufficient":false}',
    '```json\n{"answer":"hello","citations":[],"insufficient":false}\n```',
    "{ malformed json",
  ])("preserves non-envelope content: %s", (content) => {
    expect(normalizeAssistantContent(content)).toBe(content)
  })
})

describe("AssistantRichText", () => {
  it("renders GFM tables through the shadcn table primitives", () => {
    const markup = render("| Feature | Details |\n| --- | --- |\n| RAM | 2048 MB |")
    expect(markup).toContain('data-slot="table-container"')
    expect(markup).toContain('data-slot="table-head"')
    expect(markup).toContain('data-slot="table-cell"')
    expect(markup).toContain("2048 MB")
  })

  it("renders a serialized answer envelope as rich content", () => {
    const markup = render(
      JSON.stringify({
        answer: "| Feature | Details |\n| --- | --- |\n| RAM | 2048 MB |",
        citations: [1],
        insufficient: false,
      })
    )
    expect(markup).toContain('data-slot="table-container"')
    expect(markup).toContain("2048 MB")
  })

  it("renders parser-validated HTML tables and sanitizes attributes", () => {
    const markup = render(
      '<table onclick="alert(1)"><thead><tr><th scope="col">Name</th></tr></thead><tbody><tr><td>Printer</td></tr></tbody></table>'
    )
    expect(markup).toContain('data-slot="table-container"')
    expect(markup).toContain('scope="col"')
    expect(markup).toContain("Printer")
    expect(markup).not.toContain("onclick")
  })

  it("keeps non-table raw HTML literal and does not render embedded media", () => {
    const markup = render('<div><img src=x onerror="alert(1)"></div>')
    expect(markup).toContain("&lt;div&gt;")
    expect(markup).toContain("&lt;img")
    expect(markup).not.toContain("<img")
    expect(markup).toContain("onerror=")
  })

  it("renders Markdown structure and suppresses unsafe link protocols", () => {
    const markup = render(
      "## Details\n\n- first\n- second\n\n`inline`\n\n```js\ncode\n```\n\n[unsafe](javascript:alert(1)) [safe](https://example.com)"
    )
    expect(markup).toContain("<h2")
    expect(markup).toContain("<ul>")
    expect(markup).toContain("<code")
    expect(markup).toContain('href="https://example.com"')
    expect(markup).not.toContain('href="javascript:')
  })
})
