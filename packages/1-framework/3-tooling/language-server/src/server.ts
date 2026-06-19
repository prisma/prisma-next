import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNearestConfigPathForFile } from '@prisma-next/config-loader';
import {
  type Connection,
  type Diagnostic,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  type InitializeParams,
  type InitializeResult,
  RegistrationRequest,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CONFIG_FILENAME, resolveConfigInputs } from './config-resolution';
import { ParseDiagnosticSeverity } from './diagnostic-mapping';
import { computeDocumentDiagnostics } from './document-diagnostics';
import type { SchemaInputSet } from './schema-inputs';

export interface LanguageServer {
  dispose(): void;
}

export type FindConfigPathForFile = (filePath: string) => Promise<string | undefined>;

interface ProjectState {
  readonly configPath: string;
  readonly inputs: SchemaInputSet;
}

export interface CreateServerOptions {
  readonly configPath?: string;
  readonly findConfigPathForFile?: FindConfigPathForFile;
}

export function createServer(
  connection: Connection,
  options?: CreateServerOptions,
): LanguageServer {
  const documents = new TextDocuments(TextDocument);
  const findConfigPathForFile = options?.findConfigPathForFile ?? findNearestConfigPathForFile;
  const projects = new Map<string, ProjectState>();
  const projectLoads = new Map<string, Promise<ProjectState>>();
  const documentConfigPaths = new Map<string, string>();
  let rootPath = process.cwd();
  let explicitConfigPath: string | undefined;
  let watchedConfigGlob = join(rootPath, '**', CONFIG_FILENAME);
  let supportsWatchedFilesRegistration = false;

  async function publish(uri: string, text: string): Promise<void> {
    const project = await resolveProjectForDocument(uri);
    if (project === undefined) {
      return;
    }
    const computed = computeDocumentDiagnostics(uri, text, project.inputs);
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

    const configPath = explicitConfigPath ?? (await findConfigPathForFile(filePath));
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
    const resolution = await resolveConfigInputs(dirname(configPath), configPath);
    const project: ProjectState = { configPath, inputs: resolution.inputs };
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
      const nearestConfigPath = explicitConfigPath ?? (await findConfigPathForFile(filePath));
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

  connection.onInitialize(async (params): Promise<InitializeResult> => {
    rootPath = resolveRootPath(params.rootUri, params.rootPath);
    explicitConfigPath = options?.configPath ? resolve(rootPath, options.configPath) : undefined;
    watchedConfigGlob = explicitConfigPath ?? join(rootPath, '**', CONFIG_FILENAME);
    supportsWatchedFilesRegistration = clientSupportsWatchedFilesRegistration(params);

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
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
      explicitConfigPath,
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

  documents.onDidOpen((event) => {
    publishSafely(event.document.uri, event.document.getText());
  });
  documents.onDidChangeContent((event) => {
    publishSafely(event.document.uri, event.document.getText());
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

function filePathFromUri(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function configPathsFromWatchedChanges(
  paths: readonly (string | undefined)[],
  explicitConfigPath: string | undefined,
): Set<string> {
  const configPaths = new Set<string>();
  for (const path of paths) {
    if (path === undefined) {
      continue;
    }
    if (explicitConfigPath !== undefined) {
      if (path === explicitConfigPath) {
        configPaths.add(path);
      }
      continue;
    }
    if (path.endsWith(CONFIG_FILENAME)) {
      configPaths.add(path);
    }
  }
  return configPaths;
}
