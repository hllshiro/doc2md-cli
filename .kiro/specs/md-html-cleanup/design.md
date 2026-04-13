# Design Document

## Overview

`mdCleanup` is a Listr2 pipeline task that post-processes the Markdown file produced by the `mediaConvert` stage. It reads `out/mediaConvert/{filename}.md`, applies a set of text transformations to remove or convert HTML artifacts emitted by pandoc's `docx+styles` mode, and writes the result to `out/mdCleanup/{filename}.md`.

The task is implemented as a single TypeScript module at `src/tasks/mdCleanup.ts` and registered in `src/main.ts` immediately after `mediaConvertTask`.

---

## Architecture

### Pipeline Position

```
docxInput → docxConvert → mediaConvert → mdCleanup
```

`mdCleanup` reads `ctx.docxConvertContext.outFilename` to locate the source file and writes its output path back into `AppContext` via a new `mdCleanupContext` field.

### Context Extension

```ts
// src/context.ts additions
export interface MdCleanupContext {
  outputPath: string   // absolute path to out/mdCleanup/{filename}.md
}

// AppContext gains:
mdCleanupContext?: MdCleanupContext
```

---

## Transformation Rules

All transformations are applied in a single sequential pass over the source text. The pass is line-oriented with a small look-ahead buffer to handle multi-line blocks.

### Rule 1 – Remove 正文段落 Wrappers

Pattern (multi-line block):
```
<div custom-style="正文段落">
{blank line}
{content lines}
{blank line}
</div>
```

Action: Remove the `<div …>` opening line and the `</div>` closing line. Preserve all inner lines verbatim including surrounding blank lines.

### Rule 2 – Convert Heading Blocks to ATX Headings

Pandoc emits heading-style divs as items inside an ordered list. The block spans multiple lines:

```
{N}.  <div custom-style="N级标题">

    {heading text}

    </div>
```

Where the list item may be at any indentation level (nested lists for sub-headings).

**Heading_Level_Map**:

| custom-style | ATX prefix |
|---|---|
| 一级标题 | `#` |
| 二级标题 | `##` |
| 三级标题 | `###` |
| 四级标题 | `####` |
| 五级标题 | `#####` |
| 六级标题 | `######` |

Action: Replace the entire block (list marker + indented div + inner text + closing div) with `{prefix} {heading text}` on a single line, surrounded by blank lines.

If the Chinese ordinal is not in the map, leave the block unchanged and emit a warning via `task.output`.

### Rule 3 – Convert Figure Blocks to Markdown Images

Pattern:
```html
<figure data-custom-style="..">
<img src="{src}" style="…" />
<figcaption><div data-custom-style="caption">
<p>{caption text}</p>
</div></figcaption>
</figure>
```

Action: Replace the entire `<figure>…</figure>` block with:
```markdown
![{caption text}]({src})
```

- If no `<img>` is found: remove the block and emit a warning.
- If no caption text is found: use empty alt → `![]({src})`.

### Rule 4 – Preserve Standalone Images

`<img>` tags that appear outside any `<figure>` block are copied verbatim.

### Rule 5 – Preserve Tables

`<table>…</table>` blocks are copied verbatim without any modification.

### Rule 6 – Preserve Unrecognised custom-style Blocks

`<div custom-style="…">` blocks whose style is not `正文段落` and not a recognised heading style are copied verbatim.

### Rule 7 – Pass-Through

All other content is copied verbatim in original order.

---

## Implementation Design

### Parsing Strategy

Use a **regex-based block scanner** rather than a full HTML parser. The input is well-structured pandoc output with predictable patterns. A streaming line-by-line approach with a small state machine handles multi-line blocks cleanly.

```
State machine states:
  NORMAL          – default, emit lines as-is
  IN_ZHENGWEN     – inside <div custom-style="正文段落">
  IN_HEADING      – inside a heading list-item block
  IN_FIGURE       – inside <figure>
  IN_TABLE        – inside <table>
```

### Module Structure

```
src/tasks/mdCleanup.ts
  ├── HEADING_MAP: Record<string, number>
  ├── cleanMarkdown(source: string, warn: (msg: string) => void): string
  │     └── processes source through the state machine, returns cleaned text
  └── mdCleanupTask: ListrTask<AppContext>
        ├── creates out/mdCleanup/ directory
        ├── reads Source_File
        ├── calls cleanMarkdown()
        └── writes Output_File, sets ctx.mdCleanupContext
```

`cleanMarkdown` is a pure function (no I/O) to keep it unit-testable.

### Key Regex Patterns

```ts
const RE_ZHENGWEN_OPEN  = /^<div custom-style="正文段落">$/
const RE_ZHENGWEN_CLOSE = /^<\/div>$/
const RE_HEADING_OPEN   = /^(\s*\d+\.\s+)<div custom-style="([一二三四五六]级标题)">$/
const RE_HEADING_CLOSE  = /^\s*<\/div>$/
const RE_FIGURE_OPEN    = /^<figure\b/
const RE_FIGURE_CLOSE   = /^<\/figure>$/
const RE_TABLE_OPEN     = /^<table\b/
const RE_TABLE_CLOSE    = /^<\/table>$/
const RE_IMG_SRC        = /src="([^"]+)"/
const RE_CAPTION_TEXT   = /<p>([^<]*)<\/p>/
```

---

## Data Flow

```
Source_File (string)
  │
  ▼
cleanMarkdown(source, warn)
  │  state machine pass
  ▼
cleaned string
  │
  ▼
Output_File written to out/mdCleanup/{filename}.md
ctx.mdCleanupContext.outputPath set
```

---

## Correctness Properties

### Property 1 – 正文段落 inner text preserved (invariant)

For any input containing one or more `正文段落_Block`s, the inner text lines of each block appear unchanged in the output.

### Property 2 – No 正文段落 div tags in output (invariant)

For any input, the output contains no `<div custom-style="正文段落">` or matching `</div>` lines that were part of a `正文段落_Block`.

### Property 3 – Heading level correctness (example)

For each entry in `Heading_Level_Map`, a `Heading_Block` with that style produces an ATX heading with the correct number of `#` characters.

### Property 4 – Standalone img pass-through (invariant)

For any `<img>` tag appearing outside a `<figure>` block, the identical tag appears in the output.

### Property 5 – Figure → Markdown image (example)

Given a `Figure_Block` with `src="./media/image18.jpeg"` and caption `图1 测试`, the output contains exactly `![图1 测试](./media/image18.jpeg)` and no `<figure>` tags.

### Property 6 – Table pass-through (invariant)

For any `Table_Block` in the input, the identical block appears unchanged in the output.

### Property 7 – Content order preserved (invariant)

The relative order of all non-removed content blocks in the output matches their order in the input.

### Property 8 – Idempotence

Applying `cleanMarkdown` twice to the same input produces the same result as applying it once: `cleanMarkdown(cleanMarkdown(x)) === cleanMarkdown(x)`.

---

## File Locations

| File | Purpose |
|---|---|
| `src/tasks/mdCleanup.ts` | Task implementation |
| `src/context.ts` | Add `MdCleanupContext` interface and `mdCleanupContext` field |
| `src/main.ts` | Register `mdCleanupTask` after `mediaConvertTask` |
| `out/mdCleanup/{filename}.md` | Output file (runtime artifact) |
