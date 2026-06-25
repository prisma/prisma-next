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
  type FoldingRange,
  type InitializeParams,
  type InitializeResult,
  type Position,
  RegistrationRequest,
  TextDocumentSyncKind,
  TextDocuments,
  type TextEdit,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { classifyPslCompletionContext } from './completion-context';
import { providePslCompletionItems } from './completion-provider';
import { CONFIG_FILENAME, resolveConfigInputs } from './config-resolution';
import { ParseDiagnosticSeverity } from './diagnostic-mapping';
import { computeFoldingRanges } from './folding-ranges';
import type { PipelineInputs } from './pipeline';
import {
  type CachedDocument,
  createProjectArtifacts,
  type ProjectArtifacts,
} from './project-artifacts';
import type { SchemaInputSet } from './schema-inputs';

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

export function createServer(connection: Connection): LanguageServer {
  const documents = new TextDocuments(TextDocument);
  const projects = new Map<string, ProjectState>();
  const projectLoads = new Map<string, Promise<ProjectState>>();
  const documentConfigPaths = new Map<string, string>();
  let rootPath = process.cwd();
  let watchedConfigGlob = join(rootPath, '**', CONFIG_FILENAME);
  let supportsWatchedFilesRegistration = false;

  async function publish(uri: string, text: string): Promise<void> {
    const project = await resolveProjectForDocument(uri);
    if (project === undefined) {
      return;
    }
    const currentDocument = documents.get(uri);
    if (currentDocument === undefined) {
      documentConfigPaths.delete(uri);
      return;
    }
    if (currentDocument.getText() !== text) {
      return;
    }
    const computed = project.artifacts.update(uri, text, project.inputs, project.controlStack);
    if (computed === null) {
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

  async function resolveProjectForDocument(uri: string): Promise<ProjectState | undefined> {
    const knownConfigPath = documentConfigPaths.get(uri);
    if (knownConfigPath !== undefined) {
      return resolveProject(knownConfigPath);
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
    // Preserve open-document ASTs across config reloads; the project symbol table
    // refreshes on the next publish against the new stack.
    const artifacts = projects.get(configPath)?.artifacts ?? createProjectArtifacts();
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
        if (hadProject) {
          void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
        }
      }
    }
  }

  async function republishOpenDocumentsForConfig(configPath: string): Promise<void> {
    for (const document of documents.all()) {
      const knownConfigPath = documentConfigPaths.get(document.uri);
      if (knownConfigPath === configPath) {
        await publish(document.uri, document.getText());
        continue;
      }

      const filePath = filePathFromUri(document.uri);
      if (filePath === undefined) {
        continue;
      }
      const nearestConfigPath = await findNearestConfigPathForFile(filePath);
      if (nearestConfigPath === configPath) {
        documentConfigPaths.set(document.uri, configPath);
        await publish(document.uri, document.getText());
      }
    }
  }

  function publishSafely(uri: string, text: string): void {
    void publish(uri, text).catch((error: unknown) => {
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
    if (project === undefined || !project.inputs.includes(uri)) {
      return [];
    }

    const cached = project.artifacts.getDocument(uri);
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
        }),
      ];
    } catch {
      return [];
    }
  }

  connection.onInitialize(async (params): Promise<InitializeResult> => {
    rootPath = resolveRootPath(params.rootUri, params.rootPath);
    watchedConfigGlob = join(rootPath, '**', CONFIG_FILENAME);
    supportsWatchedFilesRegistration = clientSupportsWatchedFilesRegistration(params);

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        documentFormattingProvider: true,
        foldingRangeProvider: true,
        completionProvider: {},
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
      connection.console.warn(
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
      await republishOpenDocumentsForConfig(configPath);
    }
  });

  connection.onDocumentFormatting((params) => formatDocument(params.textDocument.uri));
  connection.onCompletion((params) => completeDocument(params.textDocument.uri, params.position));

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
    const cached = project.artifacts.getDocument(params.textDocument.uri);
    if (cached === undefined) {
      return [];
    }
    return computeFoldingRanges(cached.document, cached.sourceFile);
  });

  documents.onDidOpen((event) => {
    publishSafely(event.document.uri, event.document.getText());
  });
  documents.onDidChangeContent((event) => {
    publishSafely(event.document.uri, event.document.getText());
  });
  documents.onDidClose((event) => {
    const uri = event.document.uri;
    const configPath = documentConfigPaths.get(uri);
    if (configPath !== undefined) {
      projects.get(configPath)?.artifacts.remove(uri);
    }
    documentConfigPaths.delete(uri);
    void connection.sendDiagnostics({ uri, diagnostics: [] });
  });

  documents.listen(connection);
  connection.listen();

  function artifactsForDocument(uri: string): ProjectArtifacts | undefined {
    const configPath = documentConfigPaths.get(uri);
    return configPath === undefined ? undefined : projects.get(configPath)?.artifacts;
  }

  return {
    dispose: () => {
      connection.dispose();
    },
    getDocumentAst: (uri) => artifactsForDocument(uri)?.getDocument(uri),
    getProjectSymbolTable: (uri) => artifactsForDocument(uri)?.getSymbolTable(),
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
