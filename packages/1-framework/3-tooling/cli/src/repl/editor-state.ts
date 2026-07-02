/**
 * Pure line-editor state machine. The interactive shell
 * (`line-editor.ts`) owns the terminal; every keystroke flows through
 * {@link applyKey}, which returns the next state plus an optional effect for
 * the shell to perform. Keeping the reducer pure makes the whole editing
 * model unit-testable without a TTY.
 */
import type { CompletionItem, CompletionResult } from './completion';

export interface EditorKey {
  readonly name?: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly sequence?: string;
}

export interface MenuState {
  readonly items: readonly CompletionItem[];
  readonly selected: number;
  readonly from: number;
}

export interface EditorState {
  readonly buffer: string;
  readonly cursor: number;
  readonly historyIndex: number | null;
  readonly stash: string;
  readonly menu: MenuState | null;
  readonly ghost: string | null;
}

export interface EditorContext {
  complete(buffer: string, cursor: number): CompletionResult;
  readonly history: readonly string[];
  historyGhost(prefix: string): string | null;
}

export type EditorEffect =
  | { readonly type: 'submit'; readonly input: string }
  | { readonly type: 'exit' }
  | { readonly type: 'clear-screen' }
  | { readonly type: 'cancel-line' }
  | null;

export interface EditorStep {
  readonly state: EditorState;
  readonly effect: EditorEffect;
}

export function initialEditorState(): EditorState {
  return { buffer: '', cursor: 0, historyIndex: null, stash: '', menu: null, ghost: null };
}

/** Balanced brackets outside string literals — the multiline gate. */
export function isSubmittable(buffer: string): boolean {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i]!;
    if (quote !== null) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
  }
  return depth <= 0 && quote === null;
}

const MAX_MENU_ITEMS = 8;

function endsInsideString(text: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
  }
  return quote !== null;
}

function withDerived(state: EditorState, ctx: EditorContext, openMenu: boolean): EditorState {
  let menu: MenuState | null = null;
  if (openMenu) {
    const result = ctx.complete(state.buffer, state.cursor);
    if (result.items.length > 0) {
      menu = { items: result.items.slice(0, MAX_MENU_ITEMS), selected: 0, from: result.from };
    }
  }

  let ghost: string | null = null;
  if (menu === null && state.cursor === state.buffer.length && state.buffer.length > 0) {
    const suggestion = ctx.historyGhost(state.buffer);
    if (suggestion !== null && suggestion.startsWith(state.buffer)) {
      const remainder = suggestion.slice(state.buffer.length);
      ghost = remainder.length > 0 ? remainder : null;
    }
  }

  return { ...state, menu, ghost };
}

function insertText(state: EditorState, ctx: EditorContext, text: string): EditorState {
  const buffer = state.buffer.slice(0, state.cursor) + text + state.buffer.slice(state.cursor);
  const cursor = state.cursor + text.length;
  const next = { ...state, buffer, cursor, historyIndex: null };
  const isMemberDot =
    text === '.' && state.cursor > 0 && /[\w$)]/.test(state.buffer[state.cursor - 1]!);
  const isOpeningQuote =
    (text === "'" || text === '"') && endsInsideString(buffer.slice(0, cursor));
  const keepMenuOpen = state.menu !== null && /[\w$]/.test(text);
  return withDerived(next, ctx, isMemberDot || isOpeningQuote || keepMenuOpen);
}

function acceptMenuItem(state: EditorState, ctx: EditorContext): EditorState {
  const menu = state.menu;
  if (!menu) return state;
  const item = menu.items[menu.selected];
  if (!item) return state;
  const buffer = item.insert + state.buffer.slice(state.cursor);
  const withPrefix = state.buffer.slice(0, menu.from) + buffer;
  const cursor = menu.from + item.insert.length;
  return withDerived({ ...state, buffer: withPrefix, cursor, menu: null }, ctx, false);
}

function moveMenuSelection(state: EditorState, delta: number): EditorState {
  const menu = state.menu;
  if (!menu || menu.items.length === 0) return state;
  const count = menu.items.length;
  const selected = (menu.selected + delta + count) % count;
  return { ...state, menu: { ...menu, selected } };
}

function navigateHistory(state: EditorState, ctx: EditorContext, direction: -1 | 1): EditorState {
  const history = ctx.history;
  if (history.length === 0) return state;

  if (direction === -1) {
    const index =
      state.historyIndex === null ? history.length - 1 : Math.max(0, state.historyIndex - 1);
    const stash = state.historyIndex === null ? state.buffer : state.stash;
    const buffer = history[index] ?? '';
    return {
      ...state,
      buffer,
      cursor: buffer.length,
      historyIndex: index,
      stash,
      menu: null,
      ghost: null,
    };
  }

  if (state.historyIndex === null) return state;
  if (state.historyIndex >= history.length - 1) {
    const buffer = state.stash;
    return { ...state, buffer, cursor: buffer.length, historyIndex: null, menu: null, ghost: null };
  }
  const index = state.historyIndex + 1;
  const buffer = history[index] ?? '';
  return { ...state, buffer, cursor: buffer.length, historyIndex: index, menu: null, ghost: null };
}

function deleteWordBack(state: EditorState, ctx: EditorContext): EditorState {
  let start = state.cursor;
  while (start > 0 && /\s/.test(state.buffer[start - 1]!)) start--;
  while (start > 0 && /[\w$]/.test(state.buffer[start - 1]!)) start--;
  if (start === state.cursor) return state;
  const buffer = state.buffer.slice(0, start) + state.buffer.slice(state.cursor);
  return withDerived({ ...state, buffer, cursor: start }, ctx, state.menu !== null);
}

export function applyKey(state: EditorState, key: EditorKey, ctx: EditorContext): EditorStep {
  const none = (next: EditorState): EditorStep => ({ state: next, effect: null });

  if (key.ctrl) {
    switch (key.name) {
      case 'c': {
        if (state.buffer.length > 0) {
          return { state: initialEditorState(), effect: { type: 'cancel-line' } };
        }
        return { state, effect: { type: 'cancel-line' } };
      }
      case 'd':
        if (state.buffer.length === 0) return { state, effect: { type: 'exit' } };
        return none(state);
      case 'l':
        return { state, effect: { type: 'clear-screen' } };
      case 'a':
        return none({ ...state, cursor: 0, menu: null });
      case 'e':
        return none({ ...state, cursor: state.buffer.length, menu: null });
      case 'u': {
        const buffer = state.buffer.slice(state.cursor);
        return none(withDerived({ ...state, buffer, cursor: 0 }, ctx, false));
      }
      case 'k': {
        const buffer = state.buffer.slice(0, state.cursor);
        return none(withDerived({ ...state, buffer }, ctx, false));
      }
      case 'w':
        return none(deleteWordBack(state, ctx));
      default:
        return none(state);
    }
  }

  switch (key.name) {
    case 'return': {
      if (state.menu) {
        return none(acceptMenuItem(state, ctx));
      }
      const input = state.buffer;
      if (input.trim().length === 0) return none(state);
      if (!isSubmittable(input)) {
        return none(insertText({ ...state, menu: null, ghost: null }, ctx, '\n'));
      }
      return { state: initialEditorState(), effect: { type: 'submit', input } };
    }
    case 'tab': {
      if (state.menu) {
        if (state.menu.items.length === 1) return none(acceptMenuItem(state, ctx));
        return none(acceptMenuItem(state, ctx));
      }
      const result = ctx.complete(state.buffer, state.cursor);
      if (result.items.length === 0) return none(state);
      if (result.items.length === 1) {
        const item = result.items[0]!;
        const buffer =
          state.buffer.slice(0, result.from) + item.insert + state.buffer.slice(state.cursor);
        const cursor = result.from + item.insert.length;
        return none(withDerived({ ...state, buffer, cursor, menu: null }, ctx, false));
      }
      return none({
        ...state,
        ghost: null,
        menu: { items: result.items.slice(0, MAX_MENU_ITEMS), selected: 0, from: result.from },
      });
    }
    case 'escape':
      return none(withDerived({ ...state, menu: null }, ctx, false));
    case 'up':
      if (state.menu) return none(moveMenuSelection(state, -1));
      return none(navigateHistory(state, ctx, -1));
    case 'down':
      if (state.menu) return none(moveMenuSelection(state, 1));
      return none(navigateHistory(state, ctx, 1));
    case 'left':
      return none({ ...state, cursor: Math.max(0, state.cursor - 1), menu: null });
    case 'right': {
      if (state.cursor === state.buffer.length && state.ghost !== null) {
        const buffer = state.buffer + state.ghost;
        return none(
          withDerived({ ...state, buffer, cursor: buffer.length, ghost: null }, ctx, false),
        );
      }
      return none({ ...state, cursor: Math.min(state.buffer.length, state.cursor + 1) });
    }
    case 'home':
      return none({ ...state, cursor: 0, menu: null });
    case 'end':
      return none({ ...state, cursor: state.buffer.length, menu: null });
    case 'backspace': {
      if (state.cursor === 0) return none(state);
      const buffer = state.buffer.slice(0, state.cursor - 1) + state.buffer.slice(state.cursor);
      const next = { ...state, buffer, cursor: state.cursor - 1, historyIndex: null };
      return none(withDerived(next, ctx, state.menu !== null && buffer.length > 0));
    }
    case 'delete': {
      if (state.cursor >= state.buffer.length) return none(state);
      const buffer = state.buffer.slice(0, state.cursor) + state.buffer.slice(state.cursor + 1);
      return none(withDerived({ ...state, buffer }, ctx, state.menu !== null));
    }
    default: {
      const sequence = key.sequence ?? '';
      if (sequence.length > 0 && !key.meta && sequence >= ' ') {
        return none(insertText(state, ctx, sequence));
      }
      return none(state);
    }
  }
}
