<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **justAnotherRag** (1216 symbols, 2204 relationships, 65 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "dev"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "dev" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/justAnotherRag/context` | Codebase overview, check index freshness |
| `gitnexus://repo/justAnotherRag/clusters` | All functional areas |
| `gitnexus://repo/justAnotherRag/processes` | All execution flows |
| `gitnexus://repo/justAnotherRag/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

<!-- internal-docs:start -->
# Internal Documentation

Agents must keep project documentation current as part of any code or architecture change.

## Required Docs

- `README.md`: user-facing setup and basic app usage.
- `docs/system-overview.md`: human-facing guide explaining how the full system works (end-to-end architecture, document ingestion, chat RAG flow, and the MCP offering). Agents must keep this updated as changes arrive.
- `docs/architecture.md`: module boundaries, runtime flow, and architectural rules.
- `docs/runbook.md`: commands, environment variables, worker startup, Redis setup, and troubleshooting.
- `docs/agent-maintenance.md`: documentation maintenance rules for future agents.

## Agent Rules

- Before finishing a change, decide whether README or `docs/` must be updated.
- Update docs in the same change when behavior, setup, endpoints, workers, services, environment variables, storage, or architecture changes.
- Keep `docs/system-overview.md` updated as changes arrive so human readers always have an accurate mental model of how the full system works.
- Treat `docs/architecture.md` as the handoff guide for new chat sessions.
- Treat `docs/runbook.md` as the source of truth for running and debugging the app.
- If a future agent would need to rediscover a fact, document it.

<!-- internal-docs:end -->

<!-- design-standards:start -->
# Design Standards

When working on any UI code (components, pages, styles, layouts), **MUST first read `DESIGN.md`** at the project root. It is the single source of truth for UI decisions.
<!-- design-standards:end -->
