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

// The WebSocket scheme mirrors the page origin: plain on http, secure on https.
// This is a localhost-only dev playground, so a plain socket on loopback is
// expected and fine. The serverUri type is derived from the library to avoid a
// cast. (Semgrep's detect-insecure-websocket is suppressed inline below.)
type ServerUri = Parameters<typeof languageServer>[0]['serverUri'];
const host = `${window.location.host}${wsPath}`;
const serverUri: ServerUri =
  // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket -- localhost dev playground; scheme mirrors page origin
  window.location.protocol === 'https:' ? `wss://${host}` : `ws://${host}`;

const ls = languageServer({
  serverUri,
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
