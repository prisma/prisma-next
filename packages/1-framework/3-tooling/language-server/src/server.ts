import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNearestConfigPathForFile } from '@prisma-next/config-loader';
import type { SymbolTable } from '@prisma-next/psl-parser';
import { type FormatOptions, format } from '@prisma-next/psl-parser/format';
import {
  type CompletionItem,
  type Connection,
  type Diagnostic,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  type DocumentDiagnosticReport,
  DocumentDiagnosticReportKind,
  type FoldingRange,
  type FullDocumentDiagnosticReport,
  type InitializeParams,
  type InitializeResult,
  type Position,
  type PublishDiagnosticsParams,
  type Range,
  RegistrationRequest,
  type SemanticTokens,
  TextDocumentSyncKind,
  TextDocuments,
  type TextEdit,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { classifyPslCompletionContext } from './completion-context';
import { providePslCompletionItems } from './completion-provider';
import { CONFIG_FILENAME, resolveConfigInputs } from './config-resolution';
import { type LspDiagnostic, ParseDiagnosticSeverity } from './diagnostic-mapping';
import { computeFoldingRanges } from './folding-ranges';
import type { PipelineInputs } from './pipeline';
import {
  type CachedDocument,
  createProjectArtifacts,
  type ProjectArtifacts,
} from './project-artifacts';
import type { SchemaInputSet } from './schema-inputs';
import { buildSemanticTokens, semanticTokensLegend } from './semantic-tokens';

export interface LanguageServer {
  dispose(): void;
  /**
   * Exposed for future features (completion, semantic tokens); nothing consumes
   * them yet.
   */
  getDocumentAst(uri: string): CachedDocument | undefined;
  getProjectSymbolTable(uri: string): SymbolTable | undefined;
}

interface ProjectState {
  readonly configPath: string;
  readonly inputs: SchemaInputSet;
  readonly formatter?: FormatOptions;
  /**
   * Resolved once per config and refreshed by the config-watch path — never
   * rebuilt per document.
   */
  readonly controlStack: PipelineInputs;
  readonly artifacts: ProjectArtifacts;
}

const semanticTokenSourceLimit = 100_000;

export function createServer(connection: Connection): LanguageServer {
  const documents = new TextDocuments(TextDocument);
  const projects = new Map<string, ProjectState>();
  const projectLoads = new Map<string, Promise<ProjectState>>();
  const documentConfigPaths = new Map<string, string>();
  let rootPath = process.cwd();
  let watchedConfigGlob = join(rootPath, '**', CONFIG_FILENAME);
  let supportsWatchedFilesRegistration = false;
  let clientSupportsSnippets = false;
  let clientSupportsPullDiagnostics = false;
  let clientSupportsDiagnosticsRefresh = false;
  let disposed = false;

  function sendDiagnostics(params: PublishDiagnosticsParams): void {
    if (disposed) {
      return;
    }
    void connection.sendDiagnostics(params);
  }

  function logWarn(message: string): void {
    if (disposed) {
      return;
    }
    connection.console.warn(message);
  }

  async function publish(uri: string): Promise<void> {
    const project = await resolveProjectForDocument(uri);
    if (project === undefined) {
      return;
    }
    const document = documents.get(uri);
    if (document === undefined) {
      documentConfigPaths.delete(uri);
      return;
    }
    const computed = project.artifacts.materialize(
      uri,
      document.getText(),
      project.inputs,
      project.controlStack,
    );
    if (computed === null) {
      sendDiagnostics({ uri, diagnostics: [] });
      return;
    }
    sendDiagnostics({ uri, diagnostics: toDiagnostics(computed) });
  }

  /**
   * Project-scoped so that a future multi-input symbol table can attach
   * `relatedDocuments` for cross-file effects; today a report carries only the
   * requested document's items.
   */
  function buildDocumentDiagnosticReport(
    project: ProjectState,
    uri: string,
  ): FullDocumentDiagnosticReport {
    const cached = ensureCurrent(project, uri);
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: cached === undefined ? [] : toDiagnostics(cached.diagnostics),
    };
  }

  async function resolveProjectForDocument(uri: string): Promise<ProjectState | undefined> {
    const knownConfigPath = documentConfigPaths.get(uri);
    if (knownConfigPath !== undefined) {
      const project = await resolveProjectIfLoadable(knownConfigPath);
      if (project === undefined) {
        documentConfigPaths.delete(uri);
      }
      return project;
    }

    const filePath = filePathFromUri(uri);
    if (filePath === undefined) {
      return undefined;
    }

    const configPath = await findNearestConfigPathForFile(filePath);
    if (configPath === undefined) {
      return undefined;
    }

    documentConfigPaths.set(uri, configPath);
    const project = await resolveProjectIfLoadable(configPath);
    if (project === undefined) {
      documentConfigPaths.delete(uri);
    }
    return project;
  }

  async function resolveProjectIfLoadable(configPath: string): Promise<ProjectState | undefined> {
    try {
      return await resolveProject(configPath);
    } catch {
      stopManagingProject(configPath);
      return undefined;
    }
  }

  async function resolveProject(configPath: string): Promise<ProjectState> {
    const existing = projects.get(configPath);
    if (existing !== undefined) {
      return existing;
    }
    const existingLoad = projectLoads.get(configPath);
    if (existingLoad !== undefined) {
      return existingLoad;
    }
    return queueProjectLoad(configPath);
  }

  function refreshProject(configPath: string): Promise<ProjectState> {
    return queueProjectLoad(configPath);
  }

  function queueProjectLoad(configPath: string): Promise<ProjectState> {
    const previousLoad = projectLoads.get(configPath) ?? Promise.resolve();
    const load = previousLoad
      .catch(() => undefined)
      .then(() => loadProject(configPath))
      .finally(() => {
        if (projectLoads.get(configPath) === load) {
          projectLoads.delete(configPath);
        }
      });
    projectLoads.set(configPath, load);
    return load;
  }

  async function loadProject(configPath: string): Promise<ProjectState> {
    const resolution = await resolveConfigInputs(configPath);
    // A config reload can change what a parse produces (inputs, control stack),
    // so every cached entry is evicted; the next read rematerializes against
    // the new stack.
    const artifacts = projects.get(configPath)?.artifacts ?? createProjectArtifacts();
    artifacts.clear();
    const project: ProjectState =
      resolution.formatter === undefined
        ? {
            configPath,
            inputs: resolution.inputs,
            controlStack: resolution.controlStack,
            artifacts,
          }
        : {
            configPath,
            inputs: resolution.inputs,
            formatter: resolution.formatter,
            controlStack: resolution.controlStack,
            artifacts,
          };
    projects.set(configPath, project);
    return project;
  }

  function stopManagingProject(configPath: string): void {
    const hadProject = projects.delete(configPath);
    for (const document of documents.all()) {
      if (documentConfigPaths.get(document.uri) === configPath) {
        documentConfigPaths.delete(document.uri);
        if (hadProject && !clientSupportsPullDiagnostics) {
          sendDiagnostics({ uri: document.uri, diagnostics: [] });
        }
      }
    }
  }

  async function republishOpenDocumentsForConfig(configPath: string): Promise<void> {
    for (const document of documents.all()) {
      const knownConfigPath = documentConfigPaths.get(document.uri);
      if (knownConfigPath === configPath) {
        await publish(document.uri);
        continue;
      }

      const filePath = filePathFromUri(document.uri);
      if (filePath === undefined) {
        continue;
      }
      const nearestConfigPath = await findNearestConfigPathForFile(filePath);
      if (nearestConfigPath === configPath) {
        documentConfigPaths.set(document.uri, configPath);
        await publish(document.uri);
      }
    }
  }

  function publishSafely(uri: string): void {
    void publish(uri).catch((error: unknown) => {
      if (disposed) {
        return;
      }
      connection.console.error(error instanceof Error ? error.message : String(error));
    });
  }

  async function formatDocument(uri: string): Promise<TextEdit[]> {
    const document = documents.get(uri);
    if (document === undefined) {
      return [];
    }

    let project: ProjectState | undefined;
    try {
      project = await resolveProjectForDocument(uri);
    } catch {
      return [];
    }
    if (project === undefined || !project.inputs.includes(uri)) {
      return [];
    }

    const source = document.getText();
    let formatted: string;
    try {
      formatted = format(source, project.formatter);
    } catch {
      return [];
    }

    if (formatted === source) {
      return [];
    }

    return [
      {
        range: { start: { line: 0, character: 0 }, end: document.positionAt(source.length) },
        newText: formatted,
      },
    ];
  }

  async function semanticTokensForDocument(uri: string, range?: Range): Promise<SemanticTokens> {
    const document = documents.get(uri);
    if (document === undefined) {
      return emptySemanticTokens();
    }
    const text = document.getText();
    if (text.length > semanticTokenSourceLimit) {
      return emptySemanticTokens();
    }

    const project = await resolveProjectForDocument(uri);
    if (project === undefined) {
      return emptySemanticTokens();
    }

    const cached = ensureCurrent(project, uri);
    if (cached === undefined) {
      return emptySemanticTokens();
    }

    const source = {
      document: cached.document,
      sourceFile: cached.sourceFile,
      symbolTable: project.artifacts.getSymbolTable(),
      scalarTypes: project.controlStack.scalarTypes,
    };
    return buildSemanticTokens(source, range);
  }

  async function completeDocument(uri: string, position: Position): Promise<CompletionItem[]> {
    const document = documents.get(uri);
    if (document === undefined) {
      return [];
    }

    let project: ProjectState | undefined;
    try {
      project = await resolveProjectForDocument(uri);
    } catch {
      return [];
    }
    if (project === undefined) {
      return [];
    }

    const cached = ensureCurrent(project, uri);
    const symbolTable = project.artifacts.getSymbolTable();
    if (cached === undefined || symbolTable === undefined) {
      return [];
    }

    try {
      const context = classifyPslCompletionContext({
        document: cached.document,
        sourceFile: cached.sourceFile,
        position,
      });
      return [
        ...providePslCompletionItems({
          context,
          sourceFile: cached.sourceFile,
          candidates: {
            scalarTypes: project.controlStack.scalarTypes,
            pslBlockDescriptors: project.controlStack.pslBlockDescriptors,
            symbolTable,
          },
          clientSupportsSnippets,
        }),
      ];
    } catch {
      return [];
    }
  }

  /**
   * The single synchronous materialize-on-read seam: reads the live buffer
   * from the `TextDocuments` mirror and parses on a cache miss. A present
   * entry is trusted as current: LSP messages are dispatched in order and the
   * notification handlers evict synchronously against the already-updated
   * text mirror, so every event that could change what a parse produces has
   * evicted before any read can observe the cache. Returns `undefined` for
   * unmirrored documents and non-configured inputs.
   */
  function ensureCurrent(project: ProjectState, uri: string): CachedDocument | undefined {
    const document = documents.get(uri);
    if (document === undefined) {
      return undefined;
    }
    const materialized = project.artifacts.materialize(
      uri,
      document.getText(),
      project.inputs,
      project.controlStack,
    );
    return materialized === null ? undefined : project.artifacts.getDocument(uri);
  }

  connection.onInitialize(async (params): Promise<InitializeResult> => {
    rootPath = resolveRootPath(params.rootUri, params.rootPath);
    watchedConfigGlob = join(rootPath, '**', CONFIG_FILENAME);
    supportsWatchedFilesRegistration = clientSupportsWatchedFilesRegistration(params);
    clientSupportsSnippets = clientSupportsCompletionSnippets(params);
    clientSupportsPullDiagnostics = params.capabilities.textDocument?.diagnostic !== undefined;
    clientSupportsDiagnosticsRefresh =
      params.capabilities.workspace?.diagnostics?.refreshSupport === true;

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        documentFormattingProvider: true,
        foldingRangeProvider: true,
        semanticTokensProvider: {
          legend: semanticTokensLegend,
          full: true,
          range: true,
        },
        completionProvider: { triggerCharacters: ['.'] },
        // Both flags reflect the current single-input implementation scope —
        // not a property of PSL. Once the project symbol table merges multiple
        // inputs, an edit in one file can change diagnostics in another and
        // these must flip alongside that work.
        ...(clientSupportsPullDiagnostics
          ? {
              diagnosticProvider: {
                interFileDependencies: false,
                workspaceDiagnostics: false,
              },
            }
          : {}),
      },
    };
  });

  connection.onInitialized(() => {
    if (supportsWatchedFilesRegistration) {
      void connection
        .sendRequest(RegistrationRequest.type, {
          registrations: [
            {
              id: 'prisma-next-config-watcher',
              method: DidChangeWatchedFilesNotification.type.method,
              registerOptions: { watchers: [{ globPattern: watchedConfigGlob }] },
            },
          ],
        })
        .catch(() => undefined);
    } else {
      logWarn(
        'Client does not support dynamic file-watcher registration; Prisma Next config changes will not be picked up without a restart.',
      );
    }
  });

  connection.onDidChangeWatchedFiles(async (params) => {
    const changedConfigPaths = configPathsFromWatchedChanges(
      params.changes.map((change) => filePathFromUri(change.uri)),
    );
    for (const configPath of changedConfigPaths) {
      try {
        await refreshProject(configPath);
      } catch {
        stopManagingProject(configPath);
        continue;
      }
      if (!clientSupportsPullDiagnostics) {
        await republishOpenDocumentsForConfig(configPath);
      }
    }
    if (
      clientSupportsPullDiagnostics &&
      clientSupportsDiagnosticsRefresh &&
      changedConfigPaths.size > 0 &&
      !disposed
    ) {
      void connection.languages.diagnostics.refresh().catch(() => undefined);
    }
  });

  connection.onDocumentFormatting((params) => formatDocument(params.textDocument.uri));
  connection.onCompletion((params) => completeDocument(params.textDocument.uri, params.position));

  connection.languages.semanticTokens.on((params) =>
    semanticTokensForDocument(params.textDocument.uri),
  );
  connection.languages.semanticTokens.onRange((params) =>
    semanticTokensForDocument(params.textDocument.uri, params.range),
  );

  connection.languages.diagnostics.on(async (params): Promise<DocumentDiagnosticReport> => {
    if (!clientSupportsPullDiagnostics) {
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }
    let project: ProjectState | undefined;
    try {
      project = await resolveProjectForDocument(params.textDocument.uri);
    } catch {
      project = undefined;
    }
    if (project === undefined) {
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }
    return buildDocumentDiagnosticReport(project, params.textDocument.uri);
  });

  connection.onFoldingRanges(async (params): Promise<FoldingRange[]> => {
    let project: ProjectState | undefined;
    try {
      project = await resolveProjectForDocument(params.textDocument.uri);
    } catch {
      return [];
    }
    if (project === undefined) {
      return [];
    }
    const cached = ensureCurrent(project, params.textDocument.uri);
    if (cached === undefined) {
      return [];
    }
    return computeFoldingRanges(cached.document, cached.sourceFile);
  });

  // Marking dirty is eviction: open/change evict the document's cache entry
  // before any transport work, so a later read parses the current buffer on
  // its miss. For pull clients that is all that happens (the next pull or
  // read materializes through `ensureCurrent`); for push clients the eager
  // publish then refills the cache.
  documents.onDidOpen((event) => {
    evictDocumentArtifacts(event.document.uri);
    if (clientSupportsPullDiagnostics) {
      return;
    }
    publishSafely(event.document.uri);
  });
  documents.onDidChangeContent((event) => {
    evictDocumentArtifacts(event.document.uri);
    if (clientSupportsPullDiagnostics) {
      return;
    }
    publishSafely(event.document.uri);
  });
  documents.onDidClose((event) => {
    const uri = event.document.uri;
    const configPath = documentConfigPaths.get(uri);
    if (configPath !== undefined) {
      projects.get(configPath)?.artifacts.remove(uri);
    }
    documentConfigPaths.delete(uri);
    if (!clientSupportsPullDiagnostics) {
      sendDiagnostics({ uri, diagnostics: [] });
    }
  });

  documents.listen(connection);
  connection.listen();

  function artifactsForDocument(uri: string): ProjectArtifacts | undefined {
    const configPath = documentConfigPaths.get(uri);
    return configPath === undefined ? undefined : projects.get(configPath)?.artifacts;
  }

  function evictDocumentArtifacts(uri: string): void {
    artifactsForDocument(uri)?.remove(uri);
  }

  return {
    dispose: () => {
      disposed = true;
      connection.dispose();
    },
    getDocumentAst: (uri) => artifactsForDocument(uri)?.getDocument(uri),
    getProjectSymbolTable: (uri) => artifactsForDocument(uri)?.getSymbolTable(),
  };
}

function emptySemanticTokens(): SemanticTokens {
  return { data: [] };
}

function toDiagnostics(computed: readonly LspDiagnostic[]): Diagnostic[] {
  return computed.map((diagnostic) => ({
    range: diagnostic.range,
    message: diagnostic.message,
    code: diagnostic.code,
    severity: toLspSeverity(diagnostic.severity),
    source: 'prisma-next',
  }));
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

function clientSupportsCompletionSnippets(params: InitializeParams): boolean {
  return params.capabilities.textDocument?.completion?.completionItem?.snippetSupport === true;
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

function filePathFromUri(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function configPathsFromWatchedChanges(paths: readonly (string | undefined)[]): Set<string> {
  const configPaths = new Set<string>();
  for (const path of paths) {
    if (path?.endsWith(CONFIG_FILENAME)) {
      configPaths.add(path);
    }
  }
  return configPaths;
}
