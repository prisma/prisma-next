# @prisma-next/lsp-playground (private)

A throwaway dev playground that opens a `.psl` file in a browser Monaco editor wired to the Prisma Next language server (`prisma-next lsp --stdio`) for **live PSL diagnostics** and whole-document formatting.

It is a private, unpublished `apps/` package — not part of the framework build graph and exempt from `lint:deps` layering.

## Usage

```bash
# 1. Build the CLI once (the bridge spawns its dist/cli.js):
pnpm --filter @prisma-next/cli build

# 2a. Open a blank scratch schema (no file needed):
psl-playground

# 2b. Or open an existing PSL file:
psl-playground path/to/schema.psl
```

The PSL file is **optional**. With no argument — or a path that does not yet exist — the playground opens a writable scratch schema under `.playground/` so you can start authoring immediately. Then open the printed `http://localhost:5295/` URL; parse diagnostics update live as you edit, and the header's **Format** button sends `textDocument/formatting` to the language server.

Everything (editor + LSP) is served on the single port `5295`.

### Config resolution

The language server identifies schema documents from `prisma-next.config.ts` (`contract.source.inputs`), discovering a document's config by walking up from the document's own path. The playground resolves what the editor opens, and the config that sits above it, as follows:

1. An **existing** file already inside a project (a `prisma-next.config.ts` is found walking up from it): open it in place under that config.
2. Otherwise (no file, a non-existent path, or an existing file with no project config): **stage a copy** of the schema under `.playground/` and generate a **default-postgres** config beside it — the "without a config, assume default postgres" path. Staging is required because the server resolves the generated config's `@prisma-next/*` imports and discovers the config by walking up from the staged file.

There is no `--config` flag: the language server discovers config purely by walking up from each document, so it cannot be pointed at an arbitrary config path.

## How it works

```text
Monaco editor  --LSP/WebSocket-->  ws bridge  --spawn+stdio-->  node cli.js lsp --stdio
(monaco-languageclient)             (vscode-ws-jsonrpc/server)   (@prisma-next/language-server)
```

- `src/bridge.ts` — `ws` + `vscode-ws-jsonrpc/server` (`createServerProcess` + `forward`), adapted from the TypeFox example (MIT).
- `src/cli.ts` — arg parsing, config resolution, starts the bridge + a Vite dev server for the client, and serves launch-time client config as same-origin JSON at `/__psl_playground_runtime.json` without rewriting tracked source files.
- `src/client/main.ts` — Monaco editor startup, runtime config fetch/validation, file-system overlay, and LSP client wiring.
