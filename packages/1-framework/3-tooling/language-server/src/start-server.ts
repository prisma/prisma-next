import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { type CreateServerOptions, createServer, type LanguageServer } from './server';

export interface StartServerOptions extends CreateServerOptions {
  readonly transport?: 'stdio';
}

// Entry point the `prisma-next lsp` subcommand delegates to: opens a stdio
// JSON-RPC connection and wires the server onto it.
export function startServer(options?: StartServerOptions): LanguageServer {
  const connection = createConnection(ProposedFeatures.all);
  return createServer(connection, options);
}
