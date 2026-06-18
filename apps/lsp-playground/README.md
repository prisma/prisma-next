# @prisma-next/lsp-playground (private)

A throwaway dev playground that opens a `.psl` file in a browser
[CodeMirror 6](https://codemirror.net/) editor wired to the Prisma Next
language server (`prisma-next lsp --stdio`) for **live PSL diagnostics**.

It is a private, unpublished `apps/` package — not part of the framework build
graph and exempt from `lint:deps` layering.

## Usage

```bash
# 1. Build the CLI once (the bridge spawns its dist/cli.js):
pnpm --filter @prisma-next/cli build

# 2. Point the playground at a PSL file:
pnpm --filter @prisma-next/lsp-playground start path/to/schema.psl
# or, after `pnpm install` links the bin:
psl-playground path/to/schema.psl
```

Then open the printed `http://localhost:5273/` URL. Edit the schema; parse
diagnostics update live.

### Config resolution

The language server identifies schema documents from `prisma-next.config.ts`
(`contract.source.inputs`). The playground resolves the config in this order:

1. `--config <path>` if given.
2. The nearest `prisma-next.config.ts` walking up from the `.psl` file.
3. **Fallback:** a generated **default-postgres** config pointing `prismaContract`
   at your `.psl`. Without any config, you still get diagnostics under a default
   Postgres setup.

## How it works

```
CodeMirror 6  --LSP/WebSocket-->  ws bridge  --spawn+stdio-->  node cli.js lsp --stdio
(codemirror-languageserver)       (vscode-ws-jsonrpc/server)   (@prisma-next/language-server)
```

- `src/bridge.ts` — `ws` + `vscode-ws-jsonrpc/server` (`createServerProcess` +
  `forward`), adapted from the TypeFox example (MIT).
- `src/cli.ts` — arg parsing, config resolution, starts the bridge + a Vite dev
  server for the client.
- `src/client/main.ts` — CodeMirror 6 editor with the `codemirror-languageserver`
  extension.
