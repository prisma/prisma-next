/**
 * Terminal shell for the pure editor state machine. Owns raw mode, keypress
 * decoding, and ANSI rendering of the prompt line, ghost text, and the
 * completion dropdown. All editing logic lives in `editor-state.ts`.
 */
import { emitKeypressEvents } from 'node:readline';
import stringWidth from 'string-width';
import type { CompletionItem } from './completion';
import type { EditorContext, EditorKey, EditorState } from './editor-state';
import { applyKey, initialEditorState } from './editor-state';
import { highlightCode } from './highlight';
import { type ReplPalette, replPalette } from './palette';

export interface LineEditorOptions {
  readonly input: NodeJS.ReadStream;
  readonly output: NodeJS.WriteStream;
  readonly prompt: string;
  readonly continuationPrompt: string;
  readonly color: boolean;
  readonly ctx: EditorContext;
}

export interface LineEditor {
  /** Reads one submission. Resolves `null` on exit (Ctrl+D / EOF). */
  readLine(): Promise<string | null>;
  close(): void;
}

function kindBadges(
  p: ReplPalette,
): Record<CompletionItem['kind'], { label: string; paint: (s: string) => string }> {
  return {
    namespace: { label: 'ns', paint: p.dim },
    table: { label: 'table', paint: p.cyan },
    column: { label: 'col', paint: p.yellow },
    model: { label: 'model', paint: p.green },
    field: { label: 'field', paint: p.yellow },
    relation: { label: 'rel', paint: p.magenta },
    method: { label: 'fn', paint: p.magenta },
    property: { label: 'prop', paint: p.cyan },
    enum: { label: 'enum', paint: p.green },
    global: { label: 'var', paint: p.dim },
    meta: { label: 'cmd', paint: p.dim },
  };
}

export function createLineEditor(options: LineEditorOptions): LineEditor {
  const { input, output, prompt, continuationPrompt, color, ctx } = options;
  const palette = replPalette(color);
  const badges = kindBadges(palette);
  let cursorRow = 0;
  let closed = false;

  emitKeypressEvents(input);

  function columns(): number {
    return output.columns || 80;
  }

  /** Rows a rendered line occupies once terminal wrapping is applied. */
  function wrappedRows(line: string): number {
    // string-width strips ANSI escapes internally.
    return 1 + Math.floor(Math.max(0, stringWidth(line) - 1) / columns());
  }

  function menuLines(state: EditorState): string[] {
    if (!state.menu || state.menu.items.length === 0) return [];
    const width = columns();
    const labelWidth = Math.max(...state.menu.items.map((item) => item.label.length));
    return state.menu.items.map((item, index) => {
      const badge = badges[item.kind];
      const selected = index === state.menu?.selected;
      const label = item.label.padEnd(labelWidth + 2);
      const badgeText = badge.label.padEnd(7);
      const plain = `  ${label}${badgeText}${item.detail ?? ''}`.slice(0, Math.max(8, width - 1));
      if (!color) {
        return selected ? `> ${plain.slice(2)}` : plain;
      }
      if (selected) {
        return palette.bgCyan(palette.black(plain));
      }
      const detail = plain.slice(2 + label.length + badgeText.length);
      return `  ${palette.bold(label)}${badge.paint(badgeText)}${palette.dim(detail)}`;
    });
  }

  interface RenderLayout {
    readonly lines: string[];
    readonly cursorRow: number;
    readonly cursorCol: number;
  }

  function layout(state: EditorState): RenderLayout {
    const bufferLines = state.buffer.split('\n');
    const width = columns();
    const lines: string[] = [];
    let cursorRowOut = 0;
    let cursorColOut = 0;
    let consumed = 0;
    let rowsBefore = 0;

    bufferLines.forEach((line, i) => {
      const linePrompt = i === 0 ? prompt : continuationPrompt;
      let rendered = highlightCode(line, color);
      if (i === bufferLines.length - 1 && state.ghost !== null) {
        rendered += color ? palette.dim(state.ghost) : state.ghost;
      }
      lines.push(linePrompt + rendered);

      const lineStart = consumed;
      const lineEnd = consumed + line.length;
      if (state.cursor >= lineStart && state.cursor <= lineEnd) {
        // Measure the visible width of everything left of the cursor so
        // double-width characters position correctly.
        const col = stringWidth(linePrompt) + stringWidth(line.slice(0, state.cursor - lineStart));
        if (col > 0 && col % width === 0) {
          // DECAWM pending-wrap: the terminal keeps the cursor on the last
          // column of the previous row until the next glyph is written, so
          // park on that cell instead of the (not yet real) next row.
          cursorRowOut = rowsBefore + col / width - 1;
          cursorColOut = width - 1;
        } else {
          cursorRowOut = rowsBefore + Math.floor(col / width);
          cursorColOut = col % width;
        }
      }
      rowsBefore += wrappedRows(lines[lines.length - 1]!);
      consumed = lineEnd + 1;
    });

    lines.push(...menuLines(state));
    return { lines, cursorRow: cursorRowOut, cursorCol: cursorColOut };
  }

  function totalRows(lines: readonly string[]): number {
    return lines.reduce((rows, line) => rows + wrappedRows(line), 0);
  }

  function render(state: EditorState): void {
    const next = layout(state);
    let out = '';
    if (cursorRow > 0) out += `\x1b[${cursorRow}A`;
    out += '\r\x1b[J';
    out += next.lines.join('\n');
    const endRow = totalRows(next.lines) - 1;
    if (endRow > next.cursorRow) out += `\x1b[${endRow - next.cursorRow}A`;
    out += '\r';
    if (next.cursorCol > 0) out += `\x1b[${next.cursorCol}C`;
    output.write(out);
    cursorRow = next.cursorRow;
  }

  /** Re-render without menu/ghost and park the cursor below the input. */
  function finishLine(state: EditorState): void {
    render({ ...state, menu: null, ghost: null, cursor: state.buffer.length });
    output.write('\n');
    cursorRow = 0;
  }

  function readLine(): Promise<string | null> {
    return new Promise((resolvePromise) => {
      let state = initialEditorState();
      const wasRaw = input.isRaw;
      input.setRawMode?.(true);
      input.resume();
      render(state);

      const finish = (value: string | null): void => {
        input.removeListener('keypress', onKeypress);
        input.setRawMode?.(wasRaw ?? false);
        input.pause();
        resolvePromise(value);
      };

      const onKeypress = (_chunk: string | undefined, key: EditorKey | undefined): void => {
        // Exception barrier: a throw here would become an uncaughtException
        // on the ReadStream, killing the process with the terminal stuck in
        // raw mode and the session's finally blocks never running.
        try {
          handleKey(key);
        } catch (error) {
          output.write('\n');
          process.stderr.write(
            `repl editor error: ${error instanceof Error ? error.message : String(error)}\n`,
          );
          finish(null);
        }
      };

      const handleKey = (key: EditorKey | undefined): void => {
        if (closed) {
          finish(null);
          return;
        }
        const previous = state;
        const step = applyKey(state, key ?? {}, ctx);
        state = step.state;

        switch (step.effect?.type) {
          case 'submit': {
            finishLine({ ...previous, buffer: step.effect.input });
            finish(step.effect.input);
            return;
          }
          case 'exit': {
            finishLine(state);
            finish(null);
            return;
          }
          case 'clear-screen': {
            output.write('\x1b[2J\x1b[H');
            cursorRow = 0;
            render(state);
            return;
          }
          case 'cancel-line': {
            finishLine(previous);
            render(state);
            return;
          }
          default:
            render(state);
        }
      };

      input.on('keypress', onKeypress);
    });
  }

  return {
    readLine,
    close(): void {
      closed = true;
    },
  };
}
