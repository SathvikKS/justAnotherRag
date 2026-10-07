# RAG Web Client

Vite + React client for the Local RAG API.

## Local Dev

```bash
npm run dev
```

The client calls `VITE_API_BASE_URL`, defaulting to `http://localhost:8000`.

## Chat formatting

Assistant messages render Markdown, including GitHub-flavored Markdown tables, lists, headings, blockquotes, code, and links. Responses that contain a complete API response envelope are displayed using its `answer` field. Limited table markup is supported for legacy responses; other raw HTML is treated as text. Assistant content is sanitized before it is rendered, while user messages are always shown as plain text.

## Build

```bash
npm run build
```
