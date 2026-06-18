import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Connection,
  type Diagnostic,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  type InitializeParams,
  type InitializeResult,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CONFIG_FILENAME, type ConfigResolution, resolveConfigInputs } from './config-resolution';
import { ParseDiagnosticSeverity } from './diagnostic-mapping';
import { computeDocumentDiagnostics } from './document-diagnostics';
import { emptySchemaInputSet, type SchemaInputSet } from './schema-inputs';

export interface LanguageServer {
  dispose(): void;
}

// Injectable so tests can supply a deterministic resolution; defaults to the
// config-backed {@link resolveConfigInputs}.
export type ResolveInputs = (rootPath: string, configPath?: string) => Promise<ConfigResolution>;

export interface CreateServerOptions {
  readonly configPath?: string;
  readonly resolveInputs?: ResolveInputs;
}

// Connection is injected (not created here) so tests can drive the server over
// an in-memory stream pair; `startServer` supplies the stdio one. Sync is
// incremental: the client ships deltas, but the server re-parses the full buffer.
export function createServer(
  connection: Connection,
  options?: CreateServerOptions,
): LanguageServer {
  const documents = new TextDocuments(TextDocument);
  const resolveInputs = options?.resolveInputs ?? resolveConfigInputs;
  let schemaInputs: SchemaInputSet = emptySchemaInputSet;
  let degradedReason: string | undefined;
  // Mutable: captured at `initialize`, reused by the watcher registration and the
  // re-resolution on a config change.
  let rootPath = process.cwd();
  let watchedConfigPath = join(rootPath, CONFIG_FILENAME);
  let supportsWatchedFilesRegistration = false;

  function publish(uri: string, text: string): void {
    const computed = computeDocumentDiagnostics(uri, text, schemaInputs);
    if (computed === null) {
      // Not a configured input: clear any markers published while it was one.
      void connection.sendDiagnostics({ uri, diagnostics: [] });
      return;
    }
    const diagnostics: Diagnostic[] = computed.map((diagnostic) => ({
      range: diagnostic.range,
      message: diagnostic.message,
      code: diagnostic.code,
      severity: toLspSeverity(diagnostic.severity),
      source: 'prisma-next',
    }));
    void connection.sendDiagnostics({ uri, diagnostics });
  }

  function applyResolution(resolution: ConfigResolution): void {
    schemaInputs = resolution.inputs;
    degradedReason = resolution.degradedReason;
  }

  function republishOpenDocuments(): void {
    // `publish` is idempotent per document, so re-running it over every open
    // document after a config change handles added / removed / unchanged inputs
    // uniformly without tracking which membership transitioned.
    for (const document of documents.all()) {
      publish(document.uri, document.getText());
    }
  }

  connection.onInitialize(async (params): Promise<InitializeResult> => {
    rootPath = resolveRootPath(params.rootUri, params.rootPath);
    watchedConfigPath = options?.configPath ?? join(rootPath, CONFIG_FILENAME);
    supportsWatchedFilesRegistration = clientSupportsWatchedFilesRegistration(params);
    applyResolution(await resolveInputs(rootPath, options?.configPath));

    // Diagnostics are push-only: `diagnosticProvider` (the pull model) is
    // deliberately not advertised.
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
      },
    };
  });

  // Deferred to `onInitialized` (not `onInitialize`): the connection only
  // accepts log messages and capability registrations after the handshake.
  connection.onInitialized(() => {
    if (degradedReason !== undefined) {
      connection.console.warn(degradedReason);
    }
    if (supportsWatchedFilesRegistration) {
      // Dynamic registration is the only mechanism for watched files: the LSP
      // protocol has no static `InitializeResult` form for them (see
      // `DidChangeWatchedFilesClientCapabilities`). Watch ONLY the config path
      // — schema `.psl` files are deliberately not watched (see spec non-goal).
      void connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: [{ globPattern: watchedConfigPath }],
      });
    } else {
      connection.console.warn(
        'Client does not support dynamic file-watcher registration; Prisma Next config changes will not be picked up without a restart.',
      );
    }
  });

  // The watcher is scoped to the config path, so any event it delivers is a
  // config change: re-resolve the input set and fan diagnostics back out. This
  // fires on the on-disk change whether or not the config is open in the editor.
  connection.onDidChangeWatchedFiles(async () => {
    applyResolution(await resolveInputs(rootPath, options?.configPath));
    if (degradedReason !== undefined) {
      connection.console.warn(degradedReason);
    }
    republishOpenDocuments();
  });

  documents.onDidOpen((event) => {
    publish(event.document.uri, event.document.getText());
  });
  documents.onDidChangeContent((event) => {
    publish(event.document.uri, event.document.getText());
  });
  documents.onDidClose((event) => {
    void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  });

  documents.listen(connection);
  connection.listen();

  return {
    dispose: () => {
      connection.dispose();
    },
  };
}

function toLspSeverity(severity: number): DiagnosticSeverity {
  switch (severity) {
    case ParseDiagnosticSeverity.Warning:
      return DiagnosticSeverity.Warning;
    case ParseDiagnosticSeverity.Information:
      return DiagnosticSeverity.Information;
    case ParseDiagnosticSeverity.Hint:
      return DiagnosticSeverity.Hint;
    default:
      return DiagnosticSeverity.Error;
  }
}

function clientSupportsWatchedFilesRegistration(params: InitializeParams): boolean {
  return params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
}

function resolveRootPath(
  rootUri: string | null | undefined,
  rootPath: string | null | undefined,
): string {
  if (rootUri) {
    return fileURLToPath(rootUri);
  }
  if (rootPath) {
    return rootPath;
  }
  return process.cwd();
}
