import { describe, expect, it } from 'vitest';
import { complete } from '../../src/repl/completion';
import type { EditorContext, EditorState } from '../../src/repl/editor-state';
import { applyKey, initialEditorState } from '../../src/repl/editor-state';
import { isSubmittable } from '../../src/repl/scan';
import { extractReplSchemaInfo } from '../../src/repl/schema-info';
import { replContractFixture } from './fixture';

const schema = extractReplSchemaInfo(replContractFixture);

const ctx: EditorContext = {
  complete: (buffer, cursor) => complete(buffer, cursor, schema),
  history: [],
  historyGhost: () => null,
};

function type(state: EditorState, text: string): EditorState {
  let current = state;
  for (const ch of text) {
    current = applyKey(current, { sequence: ch }, ctx).state;
  }
  return current;
}

describe('isSubmittable', () => {
  it('accepts balanced input', () => {
    expect(isSubmittable("db.sql.public.user.select('id')")).toBe(true);
  });

  it('rejects unbalanced brackets', () => {
    expect(isSubmittable('db.orm.public.User.where((u) => u.email.eq(')).toBe(false);
    expect(isSubmittable('const x = {')).toBe(false);
  });

  it('ignores brackets inside strings', () => {
    expect(isSubmittable("const s = '('")).toBe(true);
  });
});

describe('applyKey: editing', () => {
  it('inserts printable characters at the cursor', () => {
    const state = type(initialEditorState(), 'db');
    expect(state.buffer).toBe('db');
    expect(state.cursor).toBe(2);
  });

  it('moves the cursor with left and right', () => {
    let state = type(initialEditorState(), 'ab');
    state = applyKey(state, { name: 'left' }, ctx).state;
    expect(state.cursor).toBe(1);
    state = applyKey(state, { name: 'right' }, ctx).state;
    expect(state.cursor).toBe(2);
  });

  it('deletes with backspace', () => {
    let state = type(initialEditorState(), 'abc');
    state = applyKey(state, { name: 'backspace' }, ctx).state;
    expect(state.buffer).toBe('ab');
  });

  it('kills to line start with ctrl+u', () => {
    let state = type(initialEditorState(), 'hello');
    state = applyKey(state, { name: 'u', ctrl: true }, ctx).state;
    expect(state.buffer).toBe('');
  });

  it('deletes the previous word with ctrl+w', () => {
    let state = type(initialEditorState(), 'db.sql foo');
    state = applyKey(state, { name: 'w', ctrl: true }, ctx).state;
    expect(state.buffer).toBe('db.sql ');
  });

  it('jumps to start and end with ctrl+a / ctrl+e', () => {
    let state = type(initialEditorState(), 'xyz');
    state = applyKey(state, { name: 'a', ctrl: true }, ctx).state;
    expect(state.cursor).toBe(0);
    state = applyKey(state, { name: 'e', ctrl: true }, ctx).state;
    expect(state.cursor).toBe(3);
  });
});

describe('applyKey: submit and multiline', () => {
  it('submits balanced input on return', () => {
    const state = type(initialEditorState(), '1 + 1');
    const { effect } = applyKey(state, { name: 'return' }, ctx);
    expect(effect).toEqual({ type: 'submit', input: '1 + 1' });
  });

  it('inserts a newline on return when brackets are unbalanced', () => {
    const state = type(initialEditorState(), 'const x = {');
    const { state: next, effect } = applyKey(state, { name: 'return' }, ctx);
    expect(effect).toBeNull();
    expect(next.buffer).toBe('const x = {\n');
  });

  it('does not submit empty input', () => {
    const { effect } = applyKey(initialEditorState(), { name: 'return' }, ctx);
    expect(effect).toBeNull();
  });
});

describe('applyKey: completion menu', () => {
  it('opens the menu automatically after a member dot', () => {
    const state = type(initialEditorState(), 'db.');
    expect(state.menu).not.toBeNull();
    expect(state.menu?.items.map((i) => i.label)).toContain('sql');
  });

  it('filters the menu while typing', () => {
    const state = type(initialEditorState(), 'db.s');
    expect(state.menu?.items.map((i) => i.label)).toEqual(['sql']);
  });

  it('opens the menu on tab', () => {
    let state = type(initialEditorState(), 'db');
    state = applyKey(state, { name: 'escape' }, ctx).state;
    state = applyKey(state, { name: 'tab' }, ctx).state;
    expect(state.buffer).toBe('db');
  });

  it('navigates the menu with arrows and accepts with return', () => {
    let state = type(initialEditorState(), 'db.sql.public.');
    expect(state.menu?.items.map((i) => i.label)).toEqual(['user', 'post']);
    state = applyKey(state, { name: 'down' }, ctx).state;
    expect(state.menu?.selected).toBe(1);
    const { state: accepted, effect } = applyKey(state, { name: 'return' }, ctx);
    expect(effect).toBeNull();
    expect(accepted.buffer).toBe('db.sql.public.post');
    expect(accepted.menu).toBeNull();
  });

  it('accepts the selected item with tab', () => {
    const state = type(initialEditorState(), 'db.sql.public.u');
    const { state: accepted } = applyKey(state, { name: 'tab' }, ctx);
    expect(accepted.buffer).toBe('db.sql.public.user');
  });

  it('closes the menu with escape', () => {
    let state = type(initialEditorState(), 'db.');
    state = applyKey(state, { name: 'escape' }, ctx).state;
    expect(state.menu).toBeNull();
  });

  it('closes the menu when no items match', () => {
    const state = type(initialEditorState(), 'db.zzz');
    expect(state.menu).toBeNull();
  });

  it('opens a column menu on the opening quote of select()', () => {
    const state = type(initialEditorState(), "db.sql.public.user.select('");
    expect(state.menu?.items.map((i) => i.label)).toEqual(['id', 'email', 'createdAt']);
  });

  it('closes the menu on the closing quote of a string argument', () => {
    const state = type(initialEditorState(), "db.sql.public.user.select('email'");
    expect(state.menu).toBeNull();
  });

  it('wraps menu selection when navigating past the end', () => {
    let state = type(initialEditorState(), 'db.sql.public.');
    state = applyKey(state, { name: 'down' }, ctx).state;
    state = applyKey(state, { name: 'down' }, ctx).state;
    expect(state.menu?.selected).toBe(0);
  });
});

describe('applyKey: history', () => {
  const historyCtx: EditorContext = {
    ...ctx,
    history: ['first', 'second'],
  };

  it('recalls previous entries with up', () => {
    let state = initialEditorState();
    state = applyKey(state, { name: 'up' }, historyCtx).state;
    expect(state.buffer).toBe('second');
    state = applyKey(state, { name: 'up' }, historyCtx).state;
    expect(state.buffer).toBe('first');
  });

  it('returns to the stashed draft with down', () => {
    let state = type(initialEditorState(), 'draft');
    state = applyKey(state, { name: 'up' }, historyCtx).state;
    expect(state.buffer).toBe('second');
    state = applyKey(state, { name: 'down' }, historyCtx).state;
    expect(state.buffer).toBe('draft');
  });
});

describe('applyKey: ghost text', () => {
  const ghostCtx: EditorContext = {
    ...ctx,
    historyGhost: (prefix) => (prefix === 'db.sq' ? "db.sql.public.user.select('id')" : null),
  };

  it('shows a history ghost for the current prefix', () => {
    const state = type(initialEditorState(), 'db.sq');
    const ghost = applyKey(state, { name: 'escape' }, ghostCtx).state.ghost;
    expect(ghost).toBe("l.public.user.select('id')");
  });

  it('accepts the ghost with right arrow at end of buffer', () => {
    let state = type(initialEditorState(), 'db.sq');
    state = applyKey(state, { name: 'escape' }, ghostCtx).state;
    state = applyKey(state, { name: 'right' }, ghostCtx).state;
    expect(state.buffer).toBe("db.sql.public.user.select('id')");
  });
});

describe('applyKey: regressions', () => {
  it('treats the enter key name (bare \\n) like return', () => {
    const state = type(initialEditorState(), '1 + 1');
    const { effect } = applyKey(state, { name: 'enter' }, ctx);
    expect(effect).toEqual({ type: 'submit', input: '1 + 1' });
  });

  it('submits input whose comment contains an unbalanced paren', () => {
    const state = type(initialEditorState(), '1 + 1 // :-(');
    const { effect } = applyKey(state, { name: 'return' }, ctx);
    expect(effect).toEqual({ type: 'submit', input: '1 + 1 // :-(' });
  });

  it('closes the menu when the cursor moves right', () => {
    let state = type(initialEditorState(), 'db.');
    expect(state.menu).not.toBeNull();
    state = applyKey(state, { name: 'right' }, ctx).state;
    expect(state.menu).toBeNull();
  });

  it('deletes a whole surrogate pair with backspace', () => {
    let state = type(initialEditorState(), 'a');
    state = applyKey(state, { sequence: '😀' }, ctx).state;
    expect(state.buffer).toBe('a😀');
    state = applyKey(state, { name: 'backspace' }, ctx).state;
    expect(state.buffer).toBe('a');
  });

  it('steps over surrogate pairs with left and right', () => {
    let state = type(initialEditorState(), 'a');
    state = applyKey(state, { sequence: '😀' }, ctx).state;
    state = applyKey(state, { name: 'left' }, ctx).state;
    expect(state.cursor).toBe(1);
    state = applyKey(state, { name: 'right' }, ctx).state;
    expect(state.cursor).toBe(3);
  });
});

describe('applyKey: control', () => {
  it('clears the line with ctrl+c when non-empty', () => {
    const state = type(initialEditorState(), 'stuff');
    const { state: next, effect } = applyKey(state, { name: 'c', ctrl: true }, ctx);
    expect(next.buffer).toBe('');
    expect(effect).toEqual({ type: 'cancel-line' });
  });

  it('exits with ctrl+d on empty buffer', () => {
    const { effect } = applyKey(initialEditorState(), { name: 'd', ctrl: true }, ctx);
    expect(effect).toEqual({ type: 'exit' });
  });

  it('requests screen clear with ctrl+l', () => {
    const { effect } = applyKey(initialEditorState(), { name: 'l', ctrl: true }, ctx);
    expect(effect).toEqual({ type: 'clear-screen' });
  });
});
