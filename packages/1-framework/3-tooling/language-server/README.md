# @prisma-next/language-server

> **Internal package.** This package is an implementation detail of [`prisma-next`](https://www.npmjs.com/package/prisma-next)
> and is published only to support its runtime. Its API is unstable and may change
> without notice. Do not depend on this package directly; install `prisma-next` instead.

The Prisma Next language server. It speaks the Language Server Protocol over
stdio and publishes PSL parse diagnostics for the schema inputs declared in a
project's `prisma-next.config.ts`. It is launched by the `prisma-next lsp`
subcommand, so the diagnostics an editor sees always come from the project's own
`@prisma-next` version (version-matched by construction).

## Scope

Diagnostics only — no hover, completion, navigation, or formatting over LSP. A server process can manage multiple projects under the workspace root, keyed by the config file each open document belongs to.

## How it works

1. **`initialize`** — resolves the workspace root from the client's `rootUri` and registers config-file watching when the client supports it. Configs are loaded when matching documents open or when watched config files change. If a config cannot be loaded, the server does not manage that project.
2. **Document sync** — text-document sync is **incremental**
   (`TextDocumentSyncKind.Incremental`); the `TextDocuments` manager applies
   incremental edits, and the server re-parses the full current buffer on each
   change.
3. **Diagnostics** — on `didOpen` / `didChange` of a document whose URI is a
   configured PSL input, the server runs `@prisma-next/psl-parser`'s `parse()`
   (the CST path) and publishes the mapped diagnostics via
   `textDocument/publishDiagnostics`. A clean parse publishes an empty array
   (clearing markers). Documents that are not configured inputs publish nothing.

## Module layout

- `diagnostic-mapping.ts` — pure `ParseDiagnostic[] → LspDiagnostic[]` mapping.
  Free of any `vscode-languageserver` import; it returns plain shape objects
  (ranges pass through unchanged) so it stays reusable. The connection layer
  adapts the numeric severity to the LSP enum.
- `schema-inputs.ts` — resolves the schema-input set (`SchemaInputSet`) from a
  config and answers URI membership.
- `config-resolution.ts` — wraps `loadConfig` and resolves the schema inputs for a config. A standalone async function so it can be re-run on a config change without rewiring the server.
- `document-diagnostics.ts` — `computeDocumentDiagnostics(uri, text, inputs)`,
  the seam the connection layer calls.
- `server.ts` — `createServer(connection, options)` wires handlers onto an
  injected connection.
- `start-server.ts` — `startServer(options)` creates a stdio connection and
  starts the server. This is what the CLI delegates to.

## Package Location

- **Domain**: framework (target-agnostic)
- **Layer**: tooling
- **Plane**: migration
- **Path**: `packages/1-framework/3-tooling/language-server`
