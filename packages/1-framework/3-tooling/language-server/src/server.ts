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
  createProjectArtifacts,
  type DocumentArtifacts,
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
  getDocumentAst(uri: string): DocumentArtifacts | undefined;
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
  let clientCapabilities = noClientCapabilities;
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
    const artifacts = project.artifacts.document(uri);
    if (artifacts === undefined) {
      sendDiagnostics({ uri, diagnostics: [] });
      return;
    }
    sendDiagnostics({ uri, diagnostics: toDiagnostics(artifacts.diagnostics) });
  }

  /**
   * Project-scoped so a future multi-input symbol table can attach
   * `relatedDocuments` for cross-file effects.
   */
  function buildDocumentDiagnosticReport(
    project: ProjectState,
    uri: string,
  ): FullDocumentDiagnosticReport {
    const artifacts = project.artifacts.document(uri);
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: artifacts === undefined ? [] : toDiagnostics(artifacts.diagnostics),
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

    let configPath: string | undefined;
    try {
      configPath = await findNearestConfigPathForFile(filePath);
    } catch {
      // Config discovery walks the filesystem; a failure means "no project".
      return undefined;
    }
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
    // A fresh store per load: a config reload can change what a parse
    // produces (inputs, control stack), so later reads must derive from the
    // new resolution rather than anything computed under the old one.
    const artifacts = createProjectArtifacts({
      inputs: resolution.inputs,
      controlStack: resolution.controlStack,
      getText: (uri) => documents.get(uri)?.getText(),
    });
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
        if (hadProject && !clientCapabilities.pullDiagnostics) {
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

    const project = await resolveProjectForDocument(uri);
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

    const artifacts = project.artifacts.document(uri);
    if (artifacts === undefined) {
      return emptySemanticTokens();
    }

    const source = {
      document: artifacts.document,
      sourceFile: artifacts.sourceFile,
      symbolTable: artifacts.symbolTable,
      scalarTypes: project.controlStack.scalarTypes,
    };
    return buildSemanticTokens(source, range);
  }

  async function completeDocument(uri: string, position: Position): Promise<CompletionItem[]> {
    const document = documents.get(uri);
    if (document === undefined) {
      return [];
    }

    const project = await resolveProjectForDocument(uri);
    if (project === undefined) {
      return [];
    }

    const artifacts = project.artifacts.document(uri);
    if (artifacts === undefined) {
      return [];
    }

    try {
      const context = classifyPslCompletionContext({
        document: artifacts.document,
        sourceFile: artifacts.sourceFile,
        position,
      });
      return [
        ...providePslCompletionItems({
          context,
          sourceFile: artifacts.sourceFile,
          candidates: {
            scalarTypes: project.controlStack.scalarTypes,
            pslBlockDescriptors: project.controlStack.pslBlockDescriptors,
            symbolTable: artifacts.symbolTable,
          },
          clientSupportsSnippets: clientCapabilities.completionSnippets,
        }),
      ];
    } catch {
      return [];
    }
  }

  connection.onInitialize(async (params): Promise<InitializeResult> => {
    rootPath = resolveRootPath(params.rootUri, params.rootPath);
    watchedConfigGlob = join(rootPath, '**', CONFIG_FILENAME);
    clientCapabilities = resolveClientCapabilities(params);

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
        ...(clientCapabilities.pullDiagnostics
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
    if (clientCapabilities.watchedFilesRegistration) {
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
      if (!clientCapabilities.pullDiagnostics) {
        await republishOpenDocumentsForConfig(configPath);
      }
    }
    if (
      clientCapabilities.pullDiagnostics &&
      clientCapabilities.diagnosticsRefresh &&
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
    const project = await resolveProjectForDocument(params.textDocument.uri);
    if (project === undefined) {
      return { kind: DocumentDiagnosticReportKind.Full, items: [] };
    }
    return buildDocumentDiagnosticReport(project, params.textDocument.uri);
  });

  connection.onFoldingRanges(async (params): Promise<FoldingRange[]> => {
    const project = await resolveProjectForDocument(params.textDocument.uri);
    if (project === undefined) {
      return [];
    }
    const artifacts = project.artifacts.document(params.textDocument.uri);
    if (artifacts === undefined) {
      return [];
    }
    return computeFoldingRanges(artifacts.document, artifacts.sourceFile);
  });

  documents.onDidOpen((event) => {
    artifactsForDocument(event.document.uri)?.documentChanged(event.document.uri);
    if (clientCapabilities.pullDiagnostics) {
      return;
    }
    publishSafely(event.document.uri);
  });
  documents.onDidChangeContent((event) => {
    artifactsForDocument(event.document.uri)?.documentChanged(event.document.uri);
    if (clientCapabilities.pullDiagnostics) {
      return;
    }
    publishSafely(event.document.uri);
  });
  documents.onDidClose((event) => {
    const uri = event.document.uri;
    artifactsForDocument(uri)?.documentClosed(uri);
    documentConfigPaths.delete(uri);
    if (!clientCapabilities.pullDiagnostics) {
      sendDiagnostics({ uri, diagnostics: [] });
    }
  });

  documents.listen(connection);
  connection.listen();

  function artifactsForDocument(uri: string): ProjectArtifacts | undefined {
    const configPath = documentConfigPaths.get(uri);
    return configPath === undefined ? undefined : projects.get(configPath)?.artifacts;
  }

  return {
    dispose: () => {
      disposed = true;
      connection.dispose();
    },
    getDocumentAst: (uri) => artifactsForDocument(uri)?.document(uri),
    getProjectSymbolTable: (uri) => artifactsForDocument(uri)?.document(uri)?.symbolTable,
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

interface ResolvedClientCapabilities {
  readonly watchedFilesRegistration: boolean;
  readonly completionSnippets: boolean;
  readonly pullDiagnostics: boolean;
  readonly diagnosticsRefresh: boolean;
}

const noClientCapabilities: ResolvedClientCapabilities = {
  watchedFilesRegistration: false,
  completionSnippets: false,
  pullDiagnostics: false,
  diagnosticsRefresh: false,
};

function resolveClientCapabilities(params: InitializeParams): ResolvedClientCapabilities {
  return {
    watchedFilesRegistration:
      params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true,
    completionSnippets:
      params.capabilities.textDocument?.completion?.completionItem?.snippetSupport === true,
    pullDiagnostics: params.capabilities.textDocument?.diagnostic !== undefined,
    diagnosticsRefresh: params.capabilities.workspace?.diagnostics?.refreshSupport === true,
  };
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
