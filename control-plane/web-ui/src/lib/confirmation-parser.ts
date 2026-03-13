/**
 * Parses markdown text to detect structured confirmation questions from AI model output.
 *
 * Detects patterns like:
 * ### 需要你确认
 * 1. **标题**
 *    - 选项A？
 *    - 选项B？
 */

export interface ConfirmationOption {
  /** The bullet text, e.g. "是否接受我在当前仓库内新增一个独立目录..." */
  text: string;
}

export interface ConfirmationQuestion {
  /** 1-based index */
  index: number;
  /** Bold title, e.g. "项目形态" */
  title: string;
  /** Description text between title and options (if any) */
  description: string;
  /** Sub-bullet options */
  options: ConfirmationOption[];
  /** Detected answer type */
  answerType: "yes-no" | "single-choice" | "free-text";
}

export interface ConfirmationBlock {
  /** The heading text, e.g. "需要你确认" */
  heading: string;
  /** Parsed questions */
  questions: ConfirmationQuestion[];
}

/** Keywords in headings that signal a confirmation block */
const CONFIRMATION_HEADING_RE = /确认|请.*(?:回答|选择|告知)|需要.*(?:了解|知道)/;

/** Matches a numbered list item opening: "1. **title**" */
const NUMBERED_ITEM_RE = /^(\d+)\.\s+\*\*(.+?)\*\*/;

/** Matches a sub-bullet: "   - some text" */
const SUB_BULLET_RE = /^\s+[-*]\s+(.+)/;

/** Yes/no question indicators */
const YES_NO_RE = /可以吗|是否|是不是|对吗|行吗|ok\?|okay\?|符合预期/i;

/**
 * Parse raw markdown text and extract confirmation blocks.
 * Returns null if no confirmation pattern is detected.
 */
export function parseConfirmationBlock(markdown: string): ConfirmationBlock | null {
  const lines = markdown.split("\n");

  let headingText: string | null = null;
  let headingLineIdx = -1;

  // Find a heading that matches confirmation keywords
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const headingMatch = line.match(/^#{1,4}\s+(.+)/);
    if (headingMatch && CONFIRMATION_HEADING_RE.test(headingMatch[1])) {
      headingText = headingMatch[1];
      headingLineIdx = i;
      break;
    }
  }

  if (!headingText || headingLineIdx < 0) return null;

  // Parse numbered items after the heading
  const questions: ConfirmationQuestion[] = [];
  let current: {
    index: number;
    title: string;
    descLines: string[];
    options: ConfirmationOption[];
  } | null = null;

  for (let i = headingLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Stop at next heading
    if (/^#{1,4}\s+/.test(trimmed) && !NUMBERED_ITEM_RE.test(trimmed)) break;

    const numberedMatch = trimmed.match(NUMBERED_ITEM_RE);
    if (numberedMatch) {
      if (current) {
        questions.push(finalizeQuestion(current));
      }
      current = {
        index: Number.parseInt(numberedMatch[1], 10),
        title: numberedMatch[2],
        descLines: [],
        options: [],
      };
      // Check if there's text after the bold title on the same line
      const afterTitle = trimmed.slice(numberedMatch[0].length).trim();
      if (afterTitle) {
        current.descLines.push(afterTitle);
      }
      continue;
    }

    if (!current) continue;

    const bulletMatch = trimmed.match(SUB_BULLET_RE) || line.match(SUB_BULLET_RE);
    if (bulletMatch) {
      current.options.push({ text: bulletMatch[1].trim() });
    } else if (trimmed) {
      current.descLines.push(trimmed);
    }
  }

  if (current) {
    questions.push(finalizeQuestion(current));
  }

  if (questions.length === 0) return null;

  return { heading: headingText, questions };
}

function finalizeQuestion(raw: {
  index: number;
  title: string;
  descLines: string[];
  options: ConfirmationOption[];
}): ConfirmationQuestion {
  const description = raw.descLines.join("\n").trim();
  const allText = [description, ...raw.options.map((o) => o.text)].join(" ");

  let answerType: ConfirmationQuestion["answerType"] = "free-text";

  // If description text explicitly ends with a yes/no question, it's a confirmation
  const descriptionAsksYesNo = /可以吗|符合预期|行吗|对吗/.test(description);

  if (descriptionAsksYesNo) {
    answerType = "yes-no";
  } else if (raw.options.length >= 2) {
    answerType = "single-choice";
  } else if (YES_NO_RE.test(allText)) {
    answerType = "yes-no";
  }

  return {
    index: raw.index,
    title: raw.title,
    description,
    options: raw.options,
    answerType,
  };
}

/**
 * Compose the user's selections into a formatted markdown reply.
 */
export function composeConfirmationReply(
  questions: ConfirmationQuestion[],
  answers: Map<number, string>,
): string {
  const parts: string[] = [];
  for (const q of questions) {
    const answer = answers.get(q.index)?.trim();
    if (answer) {
      parts.push(`${q.index}. **${q.title}**：${answer}`);
    }
  }
  return parts.join("\n");
}
