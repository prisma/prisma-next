import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { lintGutter } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { languageServer } from 'codemirror-languageserver';
import { documentUri, rootUri, schemaPath, schemaText, wsPath } from './runtime';

const pathEl = document.getElementById('schema-path');
if (pathEl !== null) {
  pathEl.textContent = schemaPath;
}

// Build the WS URL so each branch is already the right template-literal type
// (`ws://...` / `wss://...`) that `languageServer` expects — no cast needed.
// Plain `ws://` is intentional: this is a localhost-only dev playground served
// over http, where the editor and the LSP bridge share one loopback origin;
// `wss` (TLS) is meaningless on localhost. When served over https we do use wss.
const host = `${window.location.host}${wsPath}`;
// nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
const wsUrl: `ws://${string}` | `wss://${string}` =
  window.location.protocol === 'https:' ? `wss://${host}` : `ws://${host}`;

const ls = languageServer({
  serverUri: wsUrl,
  rootUri,
  workspaceFolders: null,
  documentUri,
  // The Prisma Next server keys schema documents off config membership, not the
  // LSP languageId; any id is accepted. `prisma` matches the conventional id.
  languageId: 'prisma',
});

const parent = document.getElementById('editor');
if (parent === null) {
  throw new Error('#editor mount point not found');
}

new EditorView({
  parent,
  state: EditorState.create({
    doc: schemaText,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      lintGutter(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      ls,
    ],
  }),
});
