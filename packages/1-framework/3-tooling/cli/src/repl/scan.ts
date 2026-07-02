/**
 * Single source-code scanner shared by the completion engine and the line
 * editor. One forward pass tracks string literals (with escapes), line and
 * block comments, unmatched call parens, and bracket depth, so the multiline
 * submit gate and the completion context can never disagree about whether
 * the cursor sits inside a string or a comment.
 */

export interface OpenFrame {
  /** Index of the unmatched '(' in the scanned text. */
  readonly openIndex: number;
}

export interface SourceScan {
  /** Set when the text ends inside an unterminated string literal. */
  readonly inString: { readonly contentStart: number } | null;
  /** Set when the text ends inside an unterminated block comment. */
  readonly inBlockComment: boolean;
  /** Unmatched '(' positions, outermost first. */
  readonly openFrames: readonly OpenFrame[];
  /** For every index: true when the char is inside a string or comment. */
  readonly mask: readonly boolean[];
  /** Net depth of (), [], {} outside strings and comments. */
  readonly bracketDepth: number;
}

export function scanSource(text: string): SourceScan {
  const mask = new Array<boolean>(text.length).fill(false);
  const frames: OpenFrame[] = [];
  let quote: string | null = null;
  let contentStart = 0;
  let inBlockComment = false;
  let bracketDepth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (quote !== null) {
      mask[i] = true;
      if (ch === '\\') {
        if (i + 1 < text.length) mask[i + 1] = true;
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (inBlockComment) {
      mask[i] = true;
      if (ch === '*' && text[i + 1] === '/') {
        mask[i + 1] = true;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (ch === '/' && text[i + 1] === '/') {
      // Line comment: mask through end of line.
      while (i < text.length && text[i] !== '\n') {
        mask[i] = true;
        i++;
      }
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      mask[i] = true;
      mask[i + 1] = true;
      i++;
      inBlockComment = true;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      contentStart = i + 1;
      mask[i] = true;
      continue;
    }

    if (ch === '(') {
      frames.push({ openIndex: i });
      bracketDepth++;
    } else if (ch === ')') {
      frames.pop();
      bracketDepth--;
    } else if (ch === '[' || ch === '{') {
      bracketDepth++;
    } else if (ch === ']' || ch === '}') {
      bracketDepth--;
    }
  }

  return {
    inString: quote !== null ? { contentStart } : null,
    inBlockComment,
    openFrames: frames,
    mask,
    bracketDepth,
  };
}

/** True when the buffer parses as a complete submission (balanced brackets, no open string or block comment). */
export function isSubmittable(buffer: string): boolean {
  const scan = scanSource(buffer);
  return scan.bracketDepth <= 0 && scan.inString === null && !scan.inBlockComment;
}

export function endsInsideString(text: string): boolean {
  return scanSource(text).inString !== null;
}
