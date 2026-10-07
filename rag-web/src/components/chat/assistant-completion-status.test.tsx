import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  AssistantCompletionNotice,
  AssistantGroundingBadge,
} from "./chat-section"
import type { Grounding } from "@/lib/types"

function render(status?: "complete" | "truncated" | "interrupted" | "invalid") {
  return renderToStaticMarkup(<AssistantCompletionNotice status={status} />)
}

describe("AssistantCompletionNotice", () => {
  it("does not show a warning for complete or legacy messages", () => {
    expect(render("complete")).toBe("")
    expect(render()).toBe("")
  })

  it("explains that a truncated answer may be missing its ending", () => {
    const markup = render("truncated")

    expect(markup).toContain('role="status"')
    expect(markup).toContain(
      "Output limit reached. This answer may be incomplete."
    )
  })

  it("distinguishes interrupted and invalid responses", () => {
    expect(render("interrupted")).toContain(
      "Generation stopped before the answer was complete."
    )
    expect(render("invalid")).toContain(
      "The model response was invalid. This answer may be incomplete."
    )
  })
})

describe("AssistantGroundingBadge", () => {
  it("marks an incomplete answer rejected by citation verification", () => {
    const grounding: Grounding = {
      mode: "strict",
      sources_supplied: 2,
      citations_required: true,
      citations_found: [1],
      status: "rejected_incomplete",
      raw_answer: "Partial answer",
    }
    const markup = renderToStaticMarkup(
      <AssistantGroundingBadge grounding={grounding} sourceCount={2} />
    )

    expect(markup).toContain('data-variant="destructive"')
    expect(markup).toContain(
      "Incomplete answer: rejected by citation verification"
    )
    expect(markup).not.toContain("2 sources")
  })
})
