/**
 * Terminal shell for the pure editor state machine. Owns raw mode, keypress
 * decoding, and ANSI rendering of the prompt line, ghost text, and the
 * completion dropdown. All editing logic lives in `editor-state.ts`.
 */
import { emitKeypressEvents } from 'node:readline';
import { createColors } from 'colorette';
import stringWidth from 'string-width';
import type { CompletionItem } from './completion';
import type { EditorContext, EditorKey, EditorState } from './editor-state';
import { applyKey, initialEditorState } from './editor-state';
import { highlightCode } from './highlight';

const { bgCyan, black, bold, cyan, dim, green, magenta, yellow } = createColors({
  useColor: true,
});

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

const KIND_BADGES: Record<CompletionItem['kind'], { label: string; paint: (s: string) => string }> =
  {
    namespace: { label: 'ns', paint: dim },
    table: { label: 'table', paint: cyan },
    column: { label: 'col', paint: yellow },
    model: { label: 'model', paint: green },
    field: { label: 'field', paint: yellow },
    relation: { label: 'rel', paint: magenta },
    method: { label: 'fn', paint: magenta },
    property: { label: 'prop', paint: cyan },
    enum: { label: 'enum', paint: green },
    global: { label: 'var', paint: dim },
    meta: { label: 'cmd', paint: dim },
  };

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function visibleWidth(text: string): number {
  return stringWidth(text.replaceAll(ANSI_PATTERN, ''));
}

export function createLineEditor(options: LineEditorOptions): LineEditor {
  const { input, output, prompt, continuationPrompt, color, ctx } = options;
  let cursorRow = 0;
  let closed = false;

  emitKeypressEvents(input);

  function columns(): number {
    return output.columns || 80;
  }

  function menuLines(state: EditorState): string[] {
    if (!state.menu) return [];
    const width = columns();
    const labelWidth = Math.max(...state.menu.items.map((item) => item.label.length));
    return state.menu.items.map((item, index) => {
      const badge = KIND_BADGES[item.kind];
      const selected = index === state.menu?.selected;
      const label = item.label.padEnd(labelWidth + 2);
      const badgeText = badge.label.padEnd(7);
      const plain = `  ${label}${badgeText}${item.detail ?? ''}`.slice(0, Math.max(8, width - 1));
      if (!color) {
        return selected ? `> ${plain.slice(2)}` : plain;
      }
      if (selected) {
        return bgCyan(black(plain));
      }
      const detail = plain.slice(2 + label.length + badgeText.length);
      return `  ${bold(label)}${badge.paint(badgeText)}${dim(detail)}`;
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
      const promptWidth = visibleWidth(linePrompt);
      let rendered = highlightCode(line, color);
      if (i === bufferLines.length - 1 && state.ghost !== null && color) {
        rendered += dim(state.ghost);
      } else if (i === bufferLines.length - 1 && state.ghost !== null) {
        rendered += state.ghost;
      }
      lines.push(linePrompt + rendered);

      const lineStart = consumed;
      const lineEnd = consumed + line.length;
      if (state.cursor >= lineStart && state.cursor <= lineEnd) {
        const col = promptWidth + (state.cursor - lineStart);
        cursorRowOut = rowsBefore + Math.floor(col / width);
        cursorColOut = col % width;
      }
      rowsBefore += 1 + Math.floor(Math.max(0, promptWidth + line.length - 1) / width);
      consumed = lineEnd + 1;
    });

    lines.push(...menuLines(state));
    return { lines, cursorRow: cursorRowOut, cursorCol: cursorColOut };
  }

  function totalRows(lines: readonly string[]): number {
    const width = columns();
    return lines.reduce(
      (rows, line) => rows + 1 + Math.floor(Math.max(0, visibleWidth(line) - 1) / width),
      0,
    );
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
    render({ ...state, menu: null, ghost: null });
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
        if (closed) {
          finish(null);
          return;
        }
        const previous = state;
        const step = applyKey(state, key ?? {}, ctx);
        state = step.state;

        switch (step.effect?.type) {
          case 'submit': {
            finishLine({
              ...previous,
              buffer: step.effect.input,
              cursor: step.effect.input.length,
            });
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
