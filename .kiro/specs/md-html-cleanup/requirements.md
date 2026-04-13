# Requirements Document

## Introduction

The `mdCleanup` task is a post-processing pipeline stage that runs after `mediaConvert`. It reads the Markdown file produced by pandoc's `docx+styles` conversion and removes or transforms HTML artifacts that pandoc emits when preserving Word custom styles. The output is a clean, standard Markdown file suitable for downstream consumption.

The task fits into the existing Listr2 pipeline: `docxInput → docxConvert → mediaConvert → mdCleanup`. It reads from `out/mediaConvert/{filename}.md` and writes to `out/mdCleanup/{filename}.md`.

## Glossary

- **MdCleanup_Task**: The Listr2 pipeline task implemented in `src/tasks/mdCleanup.ts`.
- **Source_File**: The Markdown file produced by the `mediaConvert` task, located at `out/mediaConvert/{filename}.md`.
- **Output_File**: The cleaned Markdown file written by the `MdCleanup_Task`, located at `out/mdCleanup/{filename}.md`.
- **正文段落_Block**: A `<div custom-style="正文段落">…</div>` wrapper element emitted by pandoc around body-text paragraphs.
- **Heading_Block**: A numbered-list item whose content is a `<div custom-style="N级标题">…</div>` element, where N is a Chinese ordinal (一, 二, 三, 四, …).
- **Standalone_Img**: An `<img>` tag that appears outside any `<figure>` element.
- **Figure_Block**: A `<figure>` element that wraps an `<img>` and a `<figcaption>`.
- **Caption_Text**: The plain text content of the `<p>` element inside a `<figcaption>`.
- **ATX_Heading**: A Markdown heading written with leading `#` characters (e.g. `## Heading`).
- **Heading_Level_Map**: The mapping from Chinese ordinal to ATX heading depth: 一→1（`#`）, 二→2, 三→3, 四→4, 五→5, 六→6.
- **Markdown_Image**: A standard Markdown image expression of the form `![alt text](src)`.
- **Table_Block**: A `<table>` element and all its contents as emitted by pandoc.

---

## Requirements

### Requirement 1: Pipeline Integration

**User Story:** As a developer running the CLI tool, I want the `mdCleanup` task to execute automatically after `mediaConvert`, so that the final output is clean Markdown without manual post-processing.

#### Acceptance Criteria

1. THE `MdCleanup_Task` SHALL be registered in the Listr2 pipeline immediately after the `mediaConvert` task.
2. WHEN the `mediaConvert` task completes successfully, THE `MdCleanup_Task` SHALL read the `Source_File` path from `AppContext`.
3. THE `MdCleanup_Task` SHALL create the output directory `out/mdCleanup/` if it does not already exist.
4. THE `MdCleanup_Task` SHALL write the cleaned content to the `Output_File` path.
5. THE `MdCleanup_Task` SHALL store the `Output_File` path in `AppContext` so subsequent tasks can reference it.
6. IF the `Source_File` cannot be read, THEN THE `MdCleanup_Task` SHALL reject with a descriptive error message.

---

### Requirement 2: Remove 正文段落 Wrappers

**User Story:** As a reader of the output Markdown, I want body-text paragraphs to appear as plain Markdown paragraphs, so that the content is readable without HTML noise.

#### Acceptance Criteria

1. WHEN the `Source_File` contains a `正文段落_Block`, THE `MdCleanup_Task` SHALL remove the opening `<div custom-style="正文段落">` tag and the corresponding closing `</div>` tag.
2. THE `MdCleanup_Task` SHALL preserve the inner text content of each `正文段落_Block` without modification.
3. THE `MdCleanup_Task` SHALL preserve blank lines that separate the inner content from surrounding elements.

---

### Requirement 3: Convert Heading Blocks to ATX Headings

**User Story:** As a reader of the output Markdown, I want Word heading styles to become standard ATX headings, so that the document structure is expressed in native Markdown.

#### Acceptance Criteria

1. WHEN the `Source_File` contains a `Heading_Block`, THE `MdCleanup_Task` SHALL determine the ATX heading level using the `Heading_Level_Map` applied to the Chinese ordinal in the `custom-style` attribute value, where 一级标题 maps to `#` (h1).
2. THE `MdCleanup_Task` SHALL replace the entire `Heading_Block` (numbered-list prefix, indentation, `<div>` open tag, inner text, and `</div>` close tag) with a single ATX_Heading line of the form `{#…#} {heading text}`.
3. THE `MdCleanup_Task` SHALL strip leading and trailing whitespace from the heading text before writing the `ATX_Heading`.
4. IF a `custom-style` attribute contains a Chinese ordinal not present in the `Heading_Level_Map`, THEN THE `MdCleanup_Task` SHALL leave that block unchanged and emit a warning to task output.

---

### Requirement 4: Preserve Standalone Images

**User Story:** As a reader of the output Markdown, I want inline formula and figure images that appear outside `<figure>` blocks to remain exactly as pandoc wrote them, so that no image references are broken.

#### Acceptance Criteria

1. WHEN the `Source_File` contains a `Standalone_Img`, THE `MdCleanup_Task` SHALL copy the `<img>` tag to the `Output_File` without any modification.

---

### Requirement 5: Convert Figure Blocks to Markdown Images

**User Story:** As a reader of the output Markdown, I want captioned figures to be rendered as standard Markdown image syntax with the caption as alt text, so that the figure is portable and readable without HTML.

#### Acceptance Criteria

1. WHEN the `Source_File` contains a `Figure_Block`, THE `MdCleanup_Task` SHALL extract the `src` attribute value from the `<img>` tag inside the `<figure>`.
2. THE `MdCleanup_Task` SHALL extract the `Caption_Text` from the `<p>` element inside the `<figcaption>`.
3. THE `MdCleanup_Task` SHALL replace the entire `Figure_Block` with a single `Markdown_Image` of the form `![{Caption_Text}]({src})`.
4. IF a `Figure_Block` contains no `<img>` tag, THEN THE `MdCleanup_Task` SHALL remove the `Figure_Block` entirely and emit a warning to task output.
5. IF a `Figure_Block` contains no `Caption_Text`, THEN THE `MdCleanup_Task` SHALL use an empty string as the alt text, producing `![]({src})`.

---

### Requirement 6: Preserve Tables and Unrecognised Custom-Style Blocks

**User Story:** As a developer, I want tables and unrecognised `custom-style` blocks to pass through unchanged, so that no content is accidentally lost or corrupted.

#### Acceptance Criteria

1. WHEN the `Source_File` contains a `Table_Block`, THE `MdCleanup_Task` SHALL copy the `Table_Block` to the `Output_File` without any modification.
2. WHEN the `Source_File` contains a `<div custom-style="…">` block whose style value is not `正文段落` and not a recognised heading style (N级标题), THE `MdCleanup_Task` SHALL copy that block to the `Output_File` without any modification.

---

### Requirement 7: Preserve All Other Content

**User Story:** As a developer, I want all Markdown content not covered by the cleanup rules to pass through unchanged, so that no information is accidentally lost.

#### Acceptance Criteria

1. THE `MdCleanup_Task` SHALL copy all content not matched by Requirements 2–6 to the `Output_File` without modification.
2. THE `MdCleanup_Task` SHALL preserve the relative order of all content blocks in the `Output_File`.
