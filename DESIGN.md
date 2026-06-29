# Design Standards

This document is the single source of truth for UI decisions in this app. All developers and AI agents must follow these rules before writing or modifying any UI code. When in doubt, check this file first.

---

## Quick Compliance Checklist

Before submitting any UI change, verify:

- [ ] All colors use semantic tokens — no raw hex, no hardcoded Tailwind grays/whites/blacks
- [ ] Component tested in both light and dark mode
- [ ] shadcn/ui component used if one exists for the pattern
- [ ] Icons from `lucide-react` only — no emojis, no text symbols
- [ ] Every user action that mutates state shows a toast via `src/lib/toast.ts`
- [ ] Every async call has an error handler that surfaces a toast, never swallows silently
- [ ] Loading states must be shown where appropriate
- [ ] All interactive elements are keyboard-accessible with visible focus rings
- [ ] Touch targets are minimum 24×24 CSS px (WCAG 2.5.8)
- [ ] Tooltips on all icon-only buttons
- [ ] No long body copy, no subtitles longer than one short sentence
- [ ] Text hierarchy is respected (one H1 per page, H2/H3 for sections)
- [ ] `cn()` used for any conditional className logic

---

## 1. Design Principles

This follows a **Linear-style** design language: dense information, clean surfaces, strong hierarchy, intentional whitespace. Not minimal — precise.

| Principle                  | What it means                                                                 |
| -------------------------- | ----------------------------------------------------------------------------- |
| **Hierarchy first**        | Every screen has one primary action. Every section has a clear heading.       |
| **Dense but not crowded**  | Tight spacing with enough breathing room to separate concerns.                |
| **No decorative text**     | Labels are short. Descriptions are one sentence max. Avoid subtitles.         |
| **Interaction = feedback** | Every mutation shows a toast. Every async state shows a skeleton.             |
| **Theme-safe always**      | Components look correct in both light and dark modes without per-theme hacks. |
| **Accessible by default**  | WCAG 2.2 AA is the floor, not the ceiling.                                    |

---

## 2. Theming — The Non-Negotiable Rule

**Never hardcode colors.** Always use CSS custom property tokens.

### Why this matters

The app uses class-based dark mode (`.dark` on `<html>`). All tokens automatically swap between themes. Any hardcoded color breaks one theme.

### Semantic token reference

| Use case                         | Token class               |
| -------------------------------- | ------------------------- |
| Page / container background      | `bg-background`           |
| Card surface                     | `bg-card`                 |
| Muted / secondary surface        | `bg-muted`                |
| Subtle background (hover, zebra) | `bg-muted/50`             |
| Primary text                     | `text-foreground`         |
| Secondary / helper text          | `text-muted-foreground`   |
| Interactive / link text          | `text-primary`            |
| Error text                       | `text-destructive`        |
| Standard border                  | `border-border`           |
| Form input border                | `border-input`            |
| Primary action background        | `bg-primary`              |
| Primary action text              | `text-primary-foreground` |
| Popover / dropdown background    | `bg-popover`              |
| Sidebar background               | `bg-sidebar`              |

### Status colors

Use these only for status indicators, badges, and alert states:

| Status               | CSS variable           | Example usage                    |
| -------------------- | ---------------------- | -------------------------------- |
| Success              | `hsl(var(--success))`  | Online, saved, completed         |
| Warning              | `hsl(var(--warning))`  | Degraded, expiring, partial      |
| Critical / Error     | `hsl(var(--critical))` | Offline, failed, deleted         |
| Destructive (button) | `bg-destructive`       | Irreversible destructive actions |

### Do / Don't

```tsx
// DO
<div className="bg-background text-foreground border border-border">
<p className="text-muted-foreground text-sm">Secondary info</p>
<span className="text-destructive">Error message</span>

// DON'T
<div className="bg-white text-gray-900 border border-gray-200">   // breaks dark mode
<p className="text-slate-500 text-sm">Secondary info</p>          // breaks dark mode
<span className="text-red-500">Error message</span>               // theme-unsafe
<div style={{ background: '#0084D9' }}>                           // never inline
```

---

## 3. Component Library

### Decision order

1. **shadcn/ui** (`src/components/ui/`) — use if a component exists.
2. **Radix UI primitives** — use directly only if no shadcn wrapper exists and you are building a new one.
3. **Build custom** — only after confirming the above have no solution.
4. **Ant Design (`antd`)** — do not use. It is a legacy dependency. Do not add new antd imports.

### Available shadcn components

All live in `src/components/ui/`. Import from `@/components/ui/<name>`.

```
accordion      badge          button         calendar       card
chart          checkbox       collapsible    combobox       command
context-menu   dialog         dropdown-menu  input          label
multi-select   popover        progress       radio-group    scroll-area
select         separator      sidebar        skeleton       sonner
switch         table          tabs           textarea       theme-toggle
tooltip
```

If a needed component is not in this list, add it via the shadcn CLI (`npx shadcn@latest add <component>`), do not hand-roll it.

---

## 4. Typography

### Scale

| Class       | Size | Use                                               |
| ----------- | ---- | ------------------------------------------------- |
| `text-xs`   | 12px | Timestamps, badge labels, metadata                |
| `text-sm`   | 14px | Body text, form labels, descriptions, table cells |
| `text-base` | 16px | Default body (rare — text-sm is standard)         |
| `text-lg`   | 18px | Dialog titles, section headings                   |
| `text-2xl`  | 24px | Card titles, panel headings                       |
| `text-3xl`  | 30px | Page-level headings (H1)                          |

Avoid `text-[10px]`, `text-[11px]` custom sizes — use only where a specific density constraint exists (e.g., the existing `ReadOnlyTile` label).

### Weight

| Class           | Use                                       |
| --------------- | ----------------------------------------- |
| `font-medium`   | Standard interactive labels               |
| `font-semibold` | Card titles, section headings, badge text |
| `font-bold`     | Page H1 only                              |

### Hierarchy rules

- One `<h1>` per page. Use `text-3xl font-bold` or equivalent semantic element.
- Section headings: `text-lg font-semibold` or `text-2xl font-semibold`.
- Descriptions below a heading: `text-sm text-muted-foreground`. One sentence. No paragraph.
- Labels above inputs: `text-sm font-medium` via `<Label>`.
- Helper text below inputs: `text-xs text-muted-foreground`.
- Table column headers: `text-sm font-medium text-muted-foreground`.

### Microcopy rules

- **Sentence case** everywhere — not Title Case, not ALL CAPS (except `text-[10px] uppercase tracking-wider` overline patterns).
- **Concise labels**: "Save changes" not "Click to save your changes".
- **No filler words**: "Loading..." not "Please wait while we load your data...".
- **Action labels**: verb-noun — "Add camera", "Delete alert", "Export report".
- **Error messages**: state what happened and what to do — "Failed to save. Check your connection and try again."

---

## 5. Spacing

The app uses a tight spacing scale. Do not over-pad.

### Spacing reference

| Scale               | Value | Use                                          |
| ------------------- | ----- | -------------------------------------------- |
| `gap-1` / `p-1`     | 4px   | Icon + text in a pill, tight inline elements |
| `gap-1.5` / `p-1.5` | 6px   | Icon + label, form switch + label            |
| `gap-2` / `p-2`     | 8px   | Stacked items within a group                 |
| `gap-3` / `p-3`     | 12px  | Accordion content, medium container padding  |
| `gap-4` / `p-4`     | 16px  | Table cells, section separation              |
| `p-6`               | 24px  | Cards, page content area, dialog body        |
| `gap-6`             | 24px  | Major section separation                     |

### Layout

- Page content area: `p-6` (defined in `src/components/layout.tsx`).
- Card inner padding: `p-6` (CardContent is `p-6 pt-0` after the header).
- Between cards in a grid: `gap-4` or `gap-6`.
- Form field stack: `flex flex-col gap-2` (label → input → helper text).
- Inline icon + text: `flex items-center gap-1.5`.

### Do / Don't

```tsx
// DO
<div className="flex flex-col gap-2">
  <Label>Camera name</Label>
  <Input />
  <p className="text-xs text-muted-foreground">Used to identify the camera.</p>
</div>

// DON'T
<div className="mt-4 mb-4">
  <Label className="mb-2 block">Camera name</Label>
  <Input className="mt-1" />
  <p className="mt-2 text-sm text-gray-500">Description</p>   // gray-500 is theme-unsafe
</div>
```

---

## 6. Icons

- **Library:** `lucide-react` exclusively. No emojis. No other icon libraries.
- **Standard sizes:**

| Size class | Pixels | Use                                          |
| ---------- | ------ | -------------------------------------------- |
| `h-3 w-3`  | 12px   | Inline within badges, small indicators       |
| `h-4 w-4`  | 16px   | Buttons, form fields, sidebar nav (standard) |
| `h-5 w-5`  | 20px   | Topbar actions, section icons                |
| `h-6 w-6`  | 24px   | Feature header icons, large action buttons   |

- Always add `shrink-0` to prevent icon squishing in flex layouts.
- Icons used decoratively (next to text): add `aria-hidden="true"`.
- Icons as the sole content of a button: must have a `<Tooltip>` (see Section 9) and `aria-label` on the button.
- Status dot indicators: `h-2 w-2 rounded-full` with status color.

```tsx
// Icon-only button — always wrap with Tooltip
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon" aria-label="Refresh">
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>Refresh</TooltipContent>
</Tooltip>
```

---

## 7. Buttons

Use `src/components/ui/button.tsx`. Choose the variant that matches the action's weight.

| Variant       | Use                                           |
| ------------- | --------------------------------------------- |
| `default`     | Primary CTA — one per section/dialog          |
| `destructive` | Irreversible delete / remove actions          |
| `outline`     | Secondary actions alongside a primary         |
| `secondary`   | Neutral actions with lower visual priority    |
| `ghost`       | Toolbar buttons, icon-only actions, nav items |
| `link`        | Inline text links, "learn more" patterns      |

| Size               | Use                                     |
| ------------------ | --------------------------------------- |
| `default` (h-10)   | Standard form buttons                   |
| `sm` (h-9)         | Compact contexts (table rows, inline)   |
| `lg` (h-11)        | Prominent CTAs (modals, landing panels) |
| `icon` (h-10 w-10) | Icon-only buttons                       |

Rules:

- One `default` (primary) button per dialog or section. Everything else is secondary.
- Destructive actions require confirmation (dialog) before executing.
- Disable buttons during async operations with `disabled` prop. Show loading state inline with a spinner icon if the operation takes >300ms.
- Never disable a button without a `<Tooltip>` explaining why.

---

## 8. Forms

### Field structure

```tsx
<div className="flex flex-col gap-2">
  <Label htmlFor="field-id">Label text</Label>
  <Input id="field-id" placeholder="Placeholder" />
  {/* helper text — only when genuinely useful */}
  <p className="text-xs text-muted-foreground">One-sentence helper.</p>
  {/* validation error */}
  {error && <p className="text-xs text-destructive">{error}</p>}
</div>
```

### Rules

- Always associate `<Label>` with its input via `htmlFor`/`id`.
- Placeholder text is not a substitute for a label.
- Validation errors appear below the field in `text-xs text-destructive`.
- Required fields: mark with `*` in the label — `<Label>Name <span aria-hidden="true">*</span></Label>`. Add `required` attribute on the input.
- Group related fields in a `<fieldset>` with a `<legend>` for accessibility.
- Use `<Select>` from shadcn for dropdowns — not a native `<select>`.
- Use `<Combobox>` for searchable selects.
- Use `<MultiSelect>` for multiple selections.

---

## 9. Tooltips

Use `src/components/ui/tooltip.tsx` (Radix UI). Required scenarios:

| Scenario                          | Requirement               |
| --------------------------------- | ------------------------- |
| Icon-only button                  | Required                  |
| Truncated text that overflows     | Required (`line-clamp-*`) |
| Disabled interactive element      | Required (explain why)    |
| Abbreviated or code-style labels  | Required                  |
| Short label with optional context | Optional                  |

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon" aria-label="Delete alert">
      <Trash2 className="h-4 w-4" aria-hidden="true" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>Delete alert</TooltipContent>
</Tooltip>;
```

- Tooltip text: same microcopy rules — sentence case, concise.
- `TooltipProvider` is already mounted at the app root. Do not add another.

---

## 10. Toast Notifications

**Always use** `src/lib/toast.ts`. Never call `sonner` directly.

```ts
import { showSuccessToast, showErrorToast, showWarningToast, showInfoToast } from "@/lib/toast";
```

| Function                | Duration | Use                                            |
| ----------------------- | -------- | ---------------------------------------------- |
| `showSuccessToast(msg)` | 4s       | Mutation confirmed (saved, deleted, submitted) |
| `showErrorToast(msg)`   | 6s       | Operation failed                               |
| `showWarningToast(msg)` | 5s       | Partial success, action required               |
| `showInfoToast(msg)`    | 4s       | Neutral status update                          |

All functions accept an optional second argument: `{ description?: string, duration?: number }`.

### Rules

- Show a success toast after every successful mutation.
- Show an error toast on every caught error — no silent failures.
- Toast message: short. Description: optional, one sentence.
- Do not toast on read operations (fetches) unless they fail.
- Do not use multiple toasts for a single operation.

```ts
// DO
try {
  await saveCamera(data);
  showSuccessToast("Camera saved");
} catch (err) {
  showErrorToast("Failed to save camera", { description: "Check your connection and try again." });
}

// DON'T
try {
  await saveCamera(data);
  // no feedback to user
} catch (err) {
  console.error(err); // silent failure
}
```

---

## 11. Error Handling

No error goes unhandled. This is a strict rule.

### Levels of error handling

| Level               | Implementation                                                                    |
| ------------------- | --------------------------------------------------------------------------------- |
| **App-level**       | React Error Boundary at the root — catches render errors, shows a fallback screen |
| **Async / API**     | `try/catch` on every `await`. Always call `showErrorToast`.                       |
| **Form validation** | Inline error below the field (`text-xs text-destructive`)                         |
| **Empty data**      | Empty state component (see Section 14) — never a blank screen                     |
| **Network**         | Show the error message from the server if safe, otherwise a generic fallback      |

### Error message rules

- State what went wrong: "Failed to load cameras."
- State what to do: "Refresh the page or contact support."
- Never show raw stack traces, error codes, or API response bodies to users.
- Never use alert() or console.error() as the only feedback.

### React Query integration

```ts
useQuery({
  queryKey: ['cameras'],
  queryFn: fetchCameras,
  // Always handle the error state in the component
});

// In the component:
if (isError) return <ErrorState message="Failed to load cameras." onRetry={refetch} />;
```

---

## 12. Loading States

**Rule: skeleton-first, not spinner-first.**

- Use `<Skeleton>` from `src/components/ui/skeleton.tsx` for initial page/section loads.
- Use an inline spinner icon (`<LoaderCircle className="h-4 w-4 animate-spin" />`) only for button loading states.
- Never leave a blank white/dark area while loading — always show a skeleton.
- Ensure the skeleton matches the size of the actual element to prevent dimension change / jump when the skeleton is later replaced with the real data

```tsx
import { Skeleton } from "@/components/ui/skeleton";

// Match the shape of the actual content
{
  isLoading ? (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-3/4" />
    </div>
  ) : (
    <ActualContent />
  );
}
```

- Skeleton dimensions should approximate the real content to prevent layout shift.
- Do not show both a skeleton and a spinner simultaneously.

---

## 13. Cards

Use `src/components/ui/card.tsx` components — `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.

```tsx
<Card>
  <CardHeader>
    <CardTitle>Section title</CardTitle>
    {/* Description only if it adds real value — keep it to one sentence */}
    <CardDescription>Brief context.</CardDescription>
  </CardHeader>
  <CardContent>{/* content */}</CardContent>
  {/* Footer only for card-level actions */}
  <CardFooter className="justify-end gap-2">
    <Button variant="outline">Cancel</Button>
    <Button>Save</Button>
  </CardFooter>
</Card>
```

- `CardDescription` is optional. Omit it if the title is self-explanatory.
- Do not put a paragraph of text in `CardDescription`.
- Cards in a grid: use `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4` or `gap-6`.

---

## 14. Empty States

Every list, table, or data view must handle the empty case — never render nothing.

```tsx
// Minimal empty state pattern
<div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
  <IconComponent className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
  <p className="text-sm font-medium text-foreground">No cameras found</p>
  <p className="text-xs text-muted-foreground">Add a camera to get started.</p>
  {/* Optional CTA */}
  <Button size="sm" variant="outline">
    Add camera
  </Button>
</div>
```

Rules:

- Icon should relate to the content type (use lucide-react).
- Primary line: factual, short — "No alerts" or "No cameras found."
- Secondary line: one sentence suggesting next action, or omit entirely.
- CTA only if adding/creating is the natural next step.

---

## 15. Tables

Use `src/components/ui/table.tsx`.

```tsx
<div className="overflow-auto rounded-md border border-border">
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="text-right">Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((row) => (
        <TableRow key={row.id}>
          <TableCell className="font-medium">{row.name}</TableCell>
          <TableCell>
            <StatusBadge status={row.status} />
          </TableCell>
          <TableCell className="text-right">
            <RowActions id={row.id} />
          </TableCell>
        </TableRow>
      ))}
      {rows.length === 0 && (
        <TableRow>
          <TableCell colSpan={3} className="text-center py-12 text-muted-foreground">
            No records found.
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  </Table>
</div>
```

- Wrap in `overflow-auto rounded-md border border-border` container.
- Column headers: `text-sm font-medium text-muted-foreground`.
- Primary column cell: `font-medium`.
- Actions column: right-aligned, use icon buttons with tooltips.
- Always handle empty state inline (empty `TableRow` spanning all columns).
- Fixed header, Fixed bottom footer with page actions, only scrollable table rows. use full page width and height for tables.

---

## 16. Dialogs / Modals

Use `src/components/ui/dialog.tsx`.

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="max-w-lg">
    <DialogHeader>
      <DialogTitle>Confirm deletion</DialogTitle>
      <DialogDescription>
        This will permanently delete the camera. This cannot be undone.
      </DialogDescription>
    </DialogHeader>
    {/* body content */}
    <DialogFooter>
      <Button variant="outline" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <Button variant="destructive" onClick={handleDelete}>
        Delete
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- `DialogTitle` is required — always present, even if visually hidden with `sr-only`.
- `DialogDescription` is recommended. One sentence max.
- Footer: Cancel (outline) left, primary action right.
- Max width: `max-w-lg` default, `max-w-2xl` for complex forms.
- Focus is automatically trapped inside the dialog (Radix handles this). Do not re-implement.
- Escape key closes the dialog — do not suppress this unless the dialog has unsaved state (warn user).

---

## 17. Badges

Use `src/components/ui/badge.tsx`.

| Variant       | Use                           |
| ------------- | ----------------------------- |
| `default`     | Primary tags, active state    |
| `secondary`   | Neutral tags, categories      |
| `destructive` | Error states, critical alerts |
| `outline`     | Subtle metadata tags          |

For status badges, apply inline styles using status color variables:

```tsx
// Status badge pattern
<Badge
  className="border-transparent"
  style={{ backgroundColor: "hsl(var(--success))", color: "hsl(var(--background))" }}
>
  Online
</Badge>
```

---

## 18. Charts and Data Visualization

Use `echarts` or `recharts` with the project color palette. Do not introduce other charting libraries.

### Canonical chart palette

These colors are fixed across light and dark modes — do not swap them:

| Name    | Value              | Use                            |
| ------- | ------------------ | ------------------------------ |
| Primary | `hsl(199 89% 48%)` | First data series, line charts |
| Purple  | `hsl(262 72% 60%)` | Second data series             |
| Teal    | `hsl(173 80% 38%)` | Third data series              |
| Amber   | `hsl(43 92% 52%)`  | Fourth data series / warnings  |
| Red     | `hsl(24 85% 53%)`  | Fifth data series / alerts     |
| Orange  | `hsl(32 92% 52%)`  | Sixth data series              |

Pie/donut charts: `['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4', '#F97316']`.

### Rules

- All chart containers must be wrapped in `<ResponsiveContainer>` (recharts) or the equivalent.
- Chart backgrounds must be transparent (`bg-transparent`) so they inherit the card surface.
- Axes and grid lines: use `text-muted-foreground` for labels, `border-border` equivalents for grid.
- Always provide a legend for multi-series charts.
- Charts that can be empty must show the empty state (Section 14).

---

## 19. WCAG 2.2 Accessibility Requirements

Target: **WCAG 2.2 Level AA** in both light and dark modes.

### Contrast (1.4.3, 1.4.6, 1.4.11)

| Element                                          | Minimum ratio |
| ------------------------------------------------ | ------------- |
| Normal text (< 18px / < 14px bold)               | 4.5:1         |
| Large text (≥ 18px or ≥ 14px bold)               | 3:1           |
| UI components (borders, icons, focus indicators) | 3:1           |

Verify contrast for both themes when using any color. The semantic tokens are pre-verified — this is why you must use them.

### Keyboard navigation (2.1.1, 2.1.2)

- All interactive elements reachable by Tab.
- No keyboard traps outside of intentional modal dialogs (Radix handles modal trapping correctly).
- Custom components must forward keyboard events and support Enter/Space for activation.

### Focus appearance (2.4.7, 2.4.11, 2.4.13)

- All shadcn components already include `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` — preserve this in custom components.
- Sticky headers and toast notifications must not obscure the focused element (2.4.11).
- Focus ring must have at least 3:1 contrast against adjacent colors (2.4.13).

### Target size (2.5.8) — WCAG 2.2 new

- Minimum click/touch target: **24×24 CSS px**.
- Standard icon buttons (`size="icon"`: `h-10 w-10`) pass. Never reduce below `h-6 w-6` for interactive targets.
- If visual size must be small, use padding or a larger invisible hit area via `::before` trick.

### Labels and names (1.1.1, 2.4.6, 4.1.2)

- Every interactive element has an accessible name: visible label, `aria-label`, or `aria-labelledby`.
- Icon-only buttons: `aria-label` on the button element.
- Images: `alt` attribute always.
- Decorative icons: `aria-hidden="true"`.
- Form inputs: always associated with a `<Label>` via `htmlFor`.

### WCAG 2.2 new criteria to check

| Criterion                                | Requirement                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| **2.5.7 Dragging Movements**             | Any drag interaction (e.g., map, timeline) must have a single-pointer alternative |
| **2.5.8 Target Size**                    | Minimum 24×24 CSS px for interactive targets                                      |
| **2.4.11 Focus Not Obscured**            | Focused element not fully hidden by sticky UI or toast                            |
| **2.4.12 Focus Not Obscured (Enhanced)** | Focused element not partially obscured (AA only requires not fully hidden)        |
| **2.4.13 Focus Appearance**              | Focus indicator has sufficient size and contrast                                  |
| **3.2.6 Consistent Help**                | Help links/support in the same location across pages                              |
| **3.3.7 Redundant Entry**                | Do not ask users to re-enter information already provided in the same session     |
| **3.3.8 Accessible Authentication**      | Login must not require cognitive tasks (e.g., puzzles) without an alternative     |

### ARIA usage

- Use ARIA landmarks: `<main>`, `<nav>`, `<header>`, `<aside>`.
- `role` and `aria-*` attributes supplement semantic HTML — they do not replace it.
- Live regions: use `aria-live="polite"` for dynamic content updates (alerts feed, status changes).
- Do not use `aria-label` where a visible label already exists — use `aria-labelledby` instead.

---

## 20. Z-Index Layering Scale

Consistent z-index prevents stacking conflicts. Use these values:

| Layer         | z-index   | Elements                                           |
| ------------- | --------- | -------------------------------------------------- |
| Base          | `z-0`     | Normal page content                                |
| Raised        | `z-10`    | Sticky table headers, card overlays                |
| Dropdown      | `z-50`    | Dropdown menus, popovers, tooltips (Radix default) |
| Modal overlay | `z-50`    | Dialog backdrop                                    |
| Modal content | `z-50`    | Dialog content (above backdrop via DOM order)      |
| Toast         | `z-[100]` | Toast notifications (always on top)                |

Do not use arbitrary z-index values outside this scale. If a stacking conflict occurs, investigate root cause before increasing z-index.

---

## 21. Utilities

### `cn()` — className merging

Use for all conditional or composed className logic.

```ts
import { cn } from '@/lib/utils';

// DO
<div className={cn('flex items-center gap-2', isActive && 'bg-accent', className)}>

// DON'T
<div className={`flex items-center gap-2 ${isActive ? 'bg-accent' : ''} ${className}`}>
```

### Theme detection

The current theme is managed via `localStorage` key `'theme'` with values `'dark'` | `'light'`. The `<html>` element receives the `.dark` class. Access theme state via the `useTheme` hook or the `ThemeToggle` component — do not read `localStorage` directly in components.

---

## 22. What Not to Do — Summary

| Do not                                                                                   | Instead                                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Use raw hex or Tailwind color utilities like `text-gray-500`, `bg-white`, `bg-slate-800` | Use semantic tokens: `text-muted-foreground`, `bg-background`, `bg-card` |
| Import from `antd`                                                                       | Use shadcn/ui components                                                 |
| Use emojis in UI                                                                         | Use lucide-react icons                                                   |
| Swallow errors silently                                                                  | Always call `showErrorToast` in catch blocks                             |
| Show a blank screen while loading                                                        | Use `<Skeleton>` components                                              |
| Show blank screen when data is empty                                                     | Use the empty state pattern (Section 14)                                 |
| Write long descriptions or subtitle paragraphs                                           | One sentence max for secondary text                                      |
| Use `style={{ color: '...' }}` inline for theme colors                                   | Use Tailwind token classes                                               |
| Use spinners for initial page load                                                       | Use `<Skeleton>`                                                         |
| Use `console.error` as user-facing error feedback                                        | Use `showErrorToast`                                                     |
| Build an icon-only button without a tooltip                                              | Wrap with `<Tooltip>` and add `aria-label`                               |
| Reach for a new library without checking this file                                       | shadcn/Radix first                                                       |
| Skip testing in the other theme                                                          | Test both light and dark before marking done                             |
