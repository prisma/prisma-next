import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { lintGutter } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { languageServer } from 'codemirror-languageserver';
import { documentUri, rootUri, schemaPath, schemaText, wsUrl } from './runtime';

const pathEl = document.getElementById('schema-path');
if (pathEl !== null) {
  pathEl.textContent = schemaPath;
}

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
