---
name: word-docx
description: Create, inspect, and edit Microsoft Word documents and DOCX files
source: https://clawhub.ai/ivangdavila/word-docx
downloads: 16.6k
stars: 41
license: MIT-0
security: VirusTotal Benign, OpenClaw Benign (HIGH CONFIDENCE)
version: v1.0.2
platforms: Linux, macOS, Windows
---

# Word / DOCX

## When to Use

Use when the main artifact is a Microsoft Word document or `.docx` file,
especially when tracked changes, comments, headers, numbering, fields,
tables, templates, or compatibility matter.

## Core Rules

### 1. Treat DOCX as OOXML, not plain text

A `.docx` file is a ZIP of XML parts, so structure matters as much as visible text.
Critical parts: `word/document.xml`, `styles.xml`, `numbering.xml`, headers, footers, relationships.
Text may be split across multiple runs; never assume one sentence is in one XML node.

### 2. Preserve styles and direct formatting deliberately

- Prefer named styles over direct formatting
- When editing, extend the current style system instead of inventing a parallel one
- Copying content between documents can silently import foreign styles

### 3. Lists and numbering are their own system

- Bullets/numbering belong to Word's numbering definitions, not pasted Unicode characters
- `abstractNum`, `num`, and paragraph numbering properties all matter
- A list that looks correct in one editor can restart/flatten in another

### 4. Page layout lives in sections

- Margins, orientation, headers, footers are section-level
- First-page and odd/even headers can differ in same document
- Set page size explicitly (A4 vs US Letter changes table widths)
- Use section breaks for layout changes

### 5. Track changes, comments, and fields need precise edits

- Visible text is not the full document when tracked changes are enabled
- Comment markers and review wrappers don't behave like inline formatting
- TOC, page numbers, dates, cross-references are fields
- Edit field source carefully; cached display values lag until refresh
- For review workflows, make minimal replacements instead of rewriting paragraphs

### 6. Verify round-trip compatibility before delivery

- Complex documents can shift between Word, LibreOffice, Google Docs
- Tables, headers, embedded fonts, copied styles are common drift sources
- Treat `.docm` as macro-bearing and higher risk

## Common Traps

- Copy-paste can import unwanted styles and numbering definitions
- Header/footer images use part-specific relationships
- Empty paragraphs as spacing make templates fragile
- One visible phrase can be split across several runs, bookmarks, revision tags
- Replacing whole paragraph to change one clause breaks review quality
- Table auto-fit behavior drifts in Google Docs or LibreOffice

## Related Skills

- `documents` — General document handling and format conversion
- `brief` — Concise business writing and structured summaries
- `article` — Long-form drafting and editorial structure
