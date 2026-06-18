import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:http';
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
  /** Port the WebSocket LSP bridge listens on. */
  readonly port: number;
  /** WebSocket path the client connects to (e.g. `/psl`). */
  readonly path: string;
  /** Called if the underlying HTTP/WS server emits an error (e.g. EADDRINUSE). */
  readonly onError?: (error: NodeJS.ErrnoException) => void;
}

/**
 * Stands up a WebSocket server that, on each connection, spawns
 * `node <cliEntry> lsp --stdio --config <configPath>` and forwards LSP
 * JSON-RPC traffic between the browser editor and that stdio process.
 *
 * Adapted from the canonical `vscode-ws-jsonrpc` example
 * (TypeFox/monaco-languageclient, MIT): `createServerProcess` spawns the
 * stdio LSP and `forward` pipes the socket <-> process connections. The
 * server does not depend on the client's `processId`, so the example's
 * `initialize` `processId` rewrite is intentionally omitted.
 */
export function startBridge(options: BridgeOptions): () => void {
  const httpServer = createServer();
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const baseUrl = `http://${request.headers.host ?? 'localhost'}/`;
    const pathname = request.url !== undefined ? new URL(request.url, baseUrl).pathname : undefined;
    if (pathname !== options.path) {
      socket.destroy();
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
  });

  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    options.onError?.(error);
  });
  httpServer.listen(options.port);
  return () => {
    wss.close();
    httpServer.close();
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
