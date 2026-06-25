# @prisma-next/language-server

> **Internal package.** This package is an implementation detail of [`prisma-next`](https://www.npmjs.com/package/prisma-next)
> and is published only to support its runtime. Its API is unstable and may change
> without notice. Do not depend on this package directly; install `prisma-next` instead.

The Prisma Next language server. It speaks the Language Server Protocol over stdio and supports PSL parse diagnostics plus whole-document PSL formatting for the schema inputs declared in a project's `prisma-next.config.ts`. It is launched by the `prisma-next lsp` subcommand, so the editor features come from the project's own `@prisma-next` version (version-matched by construction).

## Scope

Supported capabilities are intentionally narrow: parse diagnostics, whole-document formatting, model field type completion, and descriptor-backed generic block parameter completion for configured PSL inputs. Formatting is only available for documents listed in `contract.source.inputs`, uses `@prisma-next/psl-parser/format`, and applies formatter options from the project's Prisma config `formatter` block. Completion is only available for open configured PSL inputs. At model field type positions, it suggests configured scalar types plus visible model, composite type, scalar, type-alias, and namespace qualifier candidates from the current project symbol table; bare positions offer namespace segments such as `auth.`, and after a namespace qualifier the provider suggests visible model and composite type members inside that namespace. The classifier also accepts contract-space-qualified type-position syntax such as `supabase:auth.User` when the namespace data is visible in the current cached artifacts. Inside descriptor-backed generic block bodies, it suggests declared parameter keys and excludes keys already present in sibling entries. Ordinary PSL `@` / `@@` attribute completions, attribute argument completions, generic block parameter value completions, relation-aware completions, and new external contract-space candidate discovery are not part of this slice. Hover, navigation, range formatting, on-type formatting, and editor-extension work remain out of scope. A server process can manage multiple projects under the workspace root, keyed by the config file each open document belongs to.

## How it works

1. **`initialize`** — resolves the workspace root from the client's `rootUri` and registers config-file watching when the client supports it. Configs are loaded when matching documents open or when watched config files change. If a config cannot be loaded, the server does not manage that project.
2. **Document sync** — text-document sync is **incremental**
   (`TextDocumentSyncKind.Incremental`); the `TextDocuments` manager applies
   incremental edits, and the server re-parses the full current buffer on each
   change.
3. **Diagnostics** — on `didOpen` / `didChange` of a document whose URI is a configured PSL input, the server runs `@prisma-next/psl-parser`'s `parse()` (the CST path) and `buildSymbolTable()`, then publishes the merged, mapped diagnostics via `textDocument/publishDiagnostics`. A clean document publishes an empty array (clearing markers). Documents that are not configured inputs publish nothing.
4. **Formatting** — on `textDocument/formatting`, the server formats the current in-memory document text with `@prisma-next/psl-parser/format` when the document is a configured PSL input. It returns one whole-document edit when the formatted text differs, and returns no edits for missing or closed documents, unconfigured documents, already canonical text, malformed PSL, or invalid formatter options.
5. **Completion** — on `textDocument/completion`, the server serves configured PSL model field type positions and descriptor-backed generic block parameter-key positions from cached parse artifacts. It classifies the cursor using the cached AST/source file, reads the current project symbol table plus project control-stack block descriptors, and returns `[]` for missing or closed documents, unconfigured documents, unavailable artifacts, unsupported contexts, ordinary attributes or attribute arguments, generic block parameter values, relation-aware scenarios, and external contract-space discovery gaps.
6. **Preserved artifacts** — each project keeps the parse artifacts it produces: the AST per open document (keyed by URI) and one symbol table per project, rebuilt from the open configured input on each edit and dropped when the document closes. They are exposed through `getDocumentAst` / `getProjectSymbolTable` so editor features read real stages instead of re-parsing. Filling the project table from several inputs — and reading unopened inputs from disk — is deferred cross-file work.

## Module layout

- `diagnostic-mapping.ts` — pure `ParseDiagnostic[] → LspDiagnostic[]` mapping.
  Free of any `vscode-languageserver` import; it returns plain shape objects
  (ranges pass through unchanged) so it stays reusable. The connection layer
  adapts the numeric severity to the LSP enum.
- `schema-inputs.ts` — resolves the schema-input set (`SchemaInputSet`) from a
  config and answers URI membership.
- `config-resolution.ts` — wraps `loadConfig` and resolves schema inputs, formatter options, and control-stack inputs for a config. A standalone async function so it can be re-run on a config change without rewiring the server.
- `document-diagnostics.ts` — `computeDocumentDiagnostics(uri, text, inputs, controlStack)`, the pure seam that parses, builds the symbol table, and returns the diagnostics plus the parse artifacts.
- `project-artifacts.ts` — `createProjectArtifacts()`, the per-project store that
  preserves the per-URI ASTs and the single project symbol table across edits.
- `completion-context.ts` — pure cursor classifier for PSL completion contexts, currently routing model field type positions and descriptor-backed generic block parameter-key positions while marking everything outside slice scope unsupported.
- `completion-provider.ts` — pure completion item provider for supported model field type and generic block parameter contexts.
- `server.ts` — `createServer(connection)` wires diagnostics, whole-document formatting, and narrow model field type completion handlers onto an injected connection.
- `start-server.ts` — `startServer()` creates a stdio connection and starts the server. This is what the CLI delegates to.

## Package Location

- **Domain**: framework (target-agnostic)
- **Layer**: tooling
- **Plane**: migration
- **Path**: `packages/1-framework/3-tooling/language-server`
