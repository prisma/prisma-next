import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import type { IWebSocket } from 'vscode-ws-jsonrpc';
import { WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc';
import { createConnection, createServerProcess, forward } from 'vscode-ws-jsonrpc/server';
import { WebSocketServer } from 'ws';

export interface BridgeOptions {
  /** Absolute path to the built CLI entry (`dist/cli.js`) to spawn. */
  readonly cliEntry: string;
  /** Absolute path to the resolved `prisma-next.config.ts`. */
  readonly configPath: string;
  /** WebSocket path the client connects to (e.g. `/psl`). */
  readonly path: string;
}

/**
 * Attaches an LSP WebSocket bridge to an existing HTTP server.
 *
 * The bridge does NOT own a port: it registers an `upgrade` listener on the
 * shared server (the same one Vite serves the editor from) and only claims
 * WebSocket upgrades on {@link BridgeOptions.path}, leaving Vite's own HMR
 * WebSocket and all HTTP requests untouched. On each accepted connection it
 * spawns `node <cliEntry> lsp --stdio --config <configPath>` and forwards LSP
 * JSON-RPC traffic between the browser editor and that stdio process.
 *
 * Adapted from the canonical `vscode-ws-jsonrpc` example
 * (TypeFox/monaco-languageclient, MIT): `createServerProcess` spawns the stdio
 * LSP and `forward` pipes the socket <-> process connections. The server does
 * not depend on the client's `processId`, so the example's `initialize`
 * `processId` rewrite is intentionally omitted.
 *
 * Returns a disposer that detaches the bridge.
 */
export function attachBridge(server: Server, options: BridgeOptions): () => void {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
    const baseUrl = `http://${request.headers.host ?? 'localhost'}/`;
    const pathname = request.url !== undefined ? new URL(request.url, baseUrl).pathname : undefined;
    // Only claim our own path; ignore everything else (e.g. Vite's HMR socket)
    // so other upgrade listeners on the shared server still get a chance.
    if (pathname !== options.path) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      const ws: IWebSocket = {
        send: (content) =>
          webSocket.send(content, (error) => {
            if (error !== null && error !== undefined) {
              throw error;
            }
          }),
        onMessage: (cb) => webSocket.on('message', (data) => cb(data)),
        onError: (cb) => webSocket.on('error', cb),
        onClose: (cb) => webSocket.on('close', cb),
        dispose: () => webSocket.close(),
      };
      if (webSocket.readyState === webSocket.OPEN) {
        launch(ws, options);
      } else {
        webSocket.on('open', () => launch(ws, options));
      }
    });
  };

  server.on('upgrade', onUpgrade);
  return () => {
    server.off('upgrade', onUpgrade);
    wss.close();
  };
}

function launch(socket: IWebSocket, options: BridgeOptions): void {
  const reader = new WebSocketMessageReader(socket);
  const writer = new WebSocketMessageWriter(socket);
  const socketConnection = createConnection(reader, writer, () => socket.dispose());
  const serverConnection = createServerProcess('PSL', 'node', [
    options.cliEntry,
    'lsp',
    '--stdio',
    '--config',
    options.configPath,
  ]);
  if (serverConnection === undefined) {
    return;
  }
  forward(socketConnection, serverConnection);
}
