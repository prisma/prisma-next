import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ClientCapabilities,
  createConnection,
  type Diagnostic,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidOpenTextDocumentNotification,
  FileChangeType,
  InitializedNotification,
  InitializeRequest,
  type InitializeResult,
  LogMessageNotification,
  MessageType,
  PublishDiagnosticsNotification,
  type RegistrationParams,
  RegistrationRequest,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { resolveSchemaInputs } from '../src/schema-inputs';
import { createServer, type ResolveInputs } from '../src/server';

type FindConfigPathForFile = (filePath: string) => Promise<string | undefined>;

const root = tmpdir();
const schemaPath = join(root, 'schema.psl');
const schemaUri = pathToFileURL(schemaPath).toString();
const configPath = join(root, 'prisma-next.config.ts');
const configUri = pathToFileURL(configPath).toString();

const resolveToSchema: ResolveInputs = async () => ({
  inputs: resolveSchemaInputs({
    contract: { source: { sourceFormat: 'psl', inputs: [schemaPath] } },
  }),
});

const watchedFilesCapabilities: ClientCapabilities = {
  workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
};

interface Harness {
  readonly client: ReturnType<typeof createConnection>;
  readonly initialize: () => Promise<InitializeResult>;
  readonly waitForDiagnostics: (uri: string) => Promise<readonly Diagnostic[]>;
  readonly waitForDiagnosticsMatching: (
    uri: string,
    predicate: (diagnostics: readonly Diagnostic[]) => boolean,
  ) => Promise<readonly Diagnostic[]>;
  readonly registrations: RegistrationParams[];
  readonly waitForWatchedFilesRegistration: (timeoutMs: number) => Promise<void>;
  readonly waitForWarning: (predicate: (message: string) => boolean) => Promise<string>;
  readonly notifyConfigChanged: (uri?: string) => void;
  dispose: () => void;
}

function startHarness(
  resolveInputs: ResolveInputs,
  capabilities: ClientCapabilities = {},
  findConfigPathForFile: FindConfigPathForFile = async () => configPath,
  explicitConfigPath?: string,
): Harness {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();

  const serverConnection = createConnection(
    new StreamMessageReader(clientToServer),
    new StreamMessageWriter(serverToClient),
  );
  const server = createServer(serverConnection, {
    resolveInputs,
    findConfigPathForFile,
    ...(explicitConfigPath ? { configPath: explicitConfigPath } : {}),
  });

  const client = createConnection(
    new StreamMessageReader(serverToClient),
    new StreamMessageWriter(clientToServer),
  );

  const pending = new Map<string, (diagnostics: readonly Diagnostic[]) => void>();
  const latest = new Map<string, readonly Diagnostic[]>();
  interface PredicateWaiter {
    readonly predicate: (diagnostics: readonly Diagnostic[]) => boolean;
    readonly resolve: (diagnostics: readonly Diagnostic[]) => void;
  }
  const predicateWaiters = new Map<string, PredicateWaiter[]>();
  client.onNotification(PublishDiagnosticsNotification.type, (params) => {
    latest.set(params.uri, params.diagnostics);
    pending.get(params.uri)?.(params.diagnostics);
    const queue = predicateWaiters.get(params.uri);
    if (queue) {
      const remaining = queue.filter((waiter) => {
        if (waiter.predicate(params.diagnostics)) {
          waiter.resolve(params.diagnostics);
          return false;
        }
        return true;
      });
      predicateWaiters.set(params.uri, remaining);
    }
  });

  const registrations: RegistrationParams[] = [];
  const isWatchedFilesRegistration = (params: RegistrationParams) =>
    params.registrations.some(
      (registration) => registration.method === 'workspace/didChangeWatchedFiles',
    );
  interface RegistrationWaiter {
    readonly resolve: () => void;
  }
  const registrationWaiters: RegistrationWaiter[] = [];
  client.onRequest(RegistrationRequest.type, (params) => {
    registrations.push(params);
    if (!isWatchedFilesRegistration(params)) {
      return;
    }
    for (const waiter of registrationWaiters.splice(0)) {
      waiter.resolve();
    }
  });

  const warnings: string[] = [];
  interface WarningWaiter {
    readonly predicate: (message: string) => boolean;
    readonly resolve: (message: string) => void;
  }
  const warningWaiters: WarningWaiter[] = [];
  client.onNotification(LogMessageNotification.type, (params) => {
    if (params.type !== MessageType.Warning) {
      return;
    }
    warnings.push(params.message);
    for (const waiter of warningWaiters.splice(0)) {
      if (waiter.predicate(params.message)) {
        waiter.resolve(params.message);
      } else {
        warningWaiters.push(waiter);
      }
    }
  });
  client.listen();

  return {
    client,
    registrations,
    waitForWatchedFilesRegistration: (timeoutMs) =>
      new Promise((resolve, reject) => {
        if (registrations.some(isWatchedFilesRegistration)) {
          resolve();
          return;
        }
        let timeout: ReturnType<typeof setTimeout>;
        const waiter = {
          resolve: () => {
            clearTimeout(timeout);
            resolve();
          },
        };
        timeout = setTimeout(() => {
          const index = registrationWaiters.indexOf(waiter);
          if (index !== -1) {
            registrationWaiters.splice(index, 1);
          }
          reject(
            new Error(
              `No workspace/didChangeWatchedFiles registration observed within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        registrationWaiters.push(waiter);
      }),
    waitForWarning: (predicate) =>
      new Promise((resolve) => {
        const existing = warnings.find((message) => predicate(message));
        if (existing !== undefined) {
          resolve(existing);
          return;
        }
        warningWaiters.push({ predicate, resolve });
      }),
    initialize: async () => {
      const result = await client.sendRequest(InitializeRequest.type, {
        processId: process.pid,
        rootUri: pathToFileURL(root).toString(),
        capabilities,
        workspaceFolders: null,
      });
      client.sendNotification(InitializedNotification.type, {});
      return result;
    },
    waitForDiagnostics: (uri) =>
      new Promise((resolve) => {
        const existing = latest.get(uri);
        if (existing) {
          resolve(existing);
          return;
        }
        pending.set(uri, resolve);
      }),
    waitForDiagnosticsMatching: (uri, predicate) =>
      new Promise((resolve) => {
        const queue = predicateWaiters.get(uri) ?? [];
        queue.push({ predicate, resolve });
        predicateWaiters.set(uri, queue);
      }),
    notifyConfigChanged: (uri = configUri) => {
      client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri, type: FileChangeType.Changed }],
      });
    },
    dispose: () => {
      client.dispose();
      server.dispose();
      clientToServer.end();
      serverToClient.end();
    },
  };
}

let harness: Harness | undefined;

afterEach(async () => {
  // Let any in-flight JSON-RPC writes settle before tearing the streams down,
  // so disposing the connections doesn't reject a notification mid-transmission.
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness?.dispose();
  harness = undefined;
});

describe('language server', { timeout: timeouts.databaseOperation }, () => {
  it('answers initialize and advertises text-document sync', async () => {
    harness = startHarness(resolveToSchema);
    const result = await harness.initialize();
    expect(result.capabilities.textDocumentSync).toBeDefined();
  });

  it('publishes parser diagnostics for an opened configured PSL input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });

    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it('publishes an empty set for a clean configured PSL input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: 'model User {\n  id Int @id\n}\n',
      },
    });

    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(diagnostics).toEqual([]);
  });

  it('publishes an empty set for a document that is not a configured input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: otherUri, languageId: 'prisma', version: 1, text: 'model {' },
    });

    const diagnostics = await harness.waitForDiagnostics(otherUri);
    expect(diagnostics).toEqual([]);
  });

  it('clears diagnostics when an edit fixes the document', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    const broken = await harness.waitForDiagnostics(schemaUri);
    expect(broken.length).toBeGreaterThan(0);

    const cleared = new Promise<readonly Diagnostic[]>((resolve) => {
      harness?.client.onNotification(PublishDiagnosticsNotification.type, (params) => {
        if (params.uri === schemaUri && params.diagnostics.length === 0) {
          resolve(params.diagnostics);
        }
      });
    });
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: 'model User {\n  id Int @id\n}\n' }],
    });
    expect(await cleared).toEqual([]);
  });

  it('initializes even when config resolution degrades to an empty input set', async () => {
    const degraded: ResolveInputs = async () => ({
      inputs: resolveSchemaInputs({}),
      degradedReason: 'no config',
    });
    harness = startHarness(degraded);
    const result = await harness.initialize();
    expect(result).toBeDefined();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(diagnostics).toEqual([]);
  });
});

function mutableResolve(initial: ResolveInputs): {
  resolve: ResolveInputs;
  set: (next: ResolveInputs) => void;
} {
  let current = initial;
  return {
    resolve: (rootPath, configPathArg) => current(rootPath, configPathArg),
    set: (next) => {
      current = next;
    },
  };
}

const resolveToNothing: ResolveInputs = async () => ({
  inputs: resolveSchemaInputs({}),
});

const resolveDegraded: ResolveInputs = async () => ({
  inputs: resolveSchemaInputs({}),
  degradedReason: 'no config',
});

function watchedFilesRegistrations(harness: Harness) {
  return harness.registrations
    .flatMap((params) => params.registrations)
    .filter((registration) => registration.method === 'workspace/didChangeWatchedFiles');
}

function findConfigForPrefixes(
  entries: readonly { readonly prefix: string; readonly configPath: string }[],
): FindConfigPathForFile {
  return async (filePath) => entries.find((entry) => filePath.startsWith(entry.prefix))?.configPath;
}

function controlledPromise(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeouts.default) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe('language server project registry', { timeout: timeouts.databaseOperation }, () => {
  it('diagnoses open inputs from two configs in one server process', async () => {
    const projectARoot = join(root, 'project-a');
    const projectBRoot = join(root, 'project-b');
    const projectAConfigPath = join(projectARoot, 'prisma-next.config.ts');
    const projectBConfigPath = join(projectBRoot, 'prisma-next.config.ts');
    const projectASchemaPath = join(projectARoot, 'schema.psl');
    const projectBSchemaPath = join(projectBRoot, 'schema.psl');
    const projectASchemaUri = pathToFileURL(projectASchemaPath).toString();
    const projectBSchemaUri = pathToFileURL(projectBSchemaPath).toString();
    const resolvedConfigs: string[] = [];
    const resolveInputs: ResolveInputs = async (_rootPath, configPathArg) => {
      if (configPathArg !== undefined) {
        resolvedConfigs.push(configPathArg);
      }
      return {
        inputs: resolveSchemaInputs({
          contract: {
            source: {
              sourceFormat: 'psl',
              inputs:
                configPathArg === projectAConfigPath
                  ? [projectASchemaPath]
                  : configPathArg === projectBConfigPath
                    ? [projectBSchemaPath]
                    : [],
            },
          },
        }),
      };
    };
    harness = startHarness(
      resolveInputs,
      {},
      findConfigForPrefixes([
        { prefix: projectARoot, configPath: projectAConfigPath },
        { prefix: projectBRoot, configPath: projectBConfigPath },
      ]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: projectASchemaUri,
        languageId: 'prisma',
        version: 1,
        text: 'model {',
      },
    });
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: projectBSchemaUri,
        languageId: 'prisma',
        version: 1,
        text: 'model {',
      },
    });

    expect((await harness.waitForDiagnostics(projectASchemaUri)).length).toBeGreaterThan(0);
    expect((await harness.waitForDiagnostics(projectBSchemaUri)).length).toBeGreaterThan(0);
    expect(resolvedConfigs).toEqual([projectAConfigPath, projectBConfigPath]);
  });

  it('creates a project when an opened file belongs to a previously unseen config', async () => {
    const unseenRoot = join(root, 'previously-unseen');
    const unseenConfigPath = join(unseenRoot, 'prisma-next.config.ts');
    const unseenSchemaPath = join(unseenRoot, 'schema.psl');
    const unseenSchemaUri = pathToFileURL(unseenSchemaPath).toString();
    const resolvedConfigs: string[] = [];
    const resolveInputs: ResolveInputs = async (_rootPath, configPathArg) => {
      if (configPathArg !== undefined) {
        resolvedConfigs.push(configPathArg);
      }
      return {
        inputs: resolveSchemaInputs({
          contract: {
            source: {
              sourceFormat: 'psl',
              inputs: configPathArg === unseenConfigPath ? [unseenSchemaPath] : [],
            },
          },
        }),
      };
    };
    harness = startHarness(
      resolveInputs,
      {},
      findConfigForPrefixes([{ prefix: unseenRoot, configPath: unseenConfigPath }]),
    );
    await harness.initialize();
    expect(resolvedConfigs).toEqual([]);

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: unseenSchemaUri,
        languageId: 'prisma',
        version: 1,
        text: 'model {',
      },
    });

    expect((await harness.waitForDiagnostics(unseenSchemaUri)).length).toBeGreaterThan(0);
    expect(resolvedConfigs).toEqual([unseenConfigPath]);
  });

  it('uses an explicit custom config path instead of nearest default config discovery', async () => {
    const projectRoot = join(root, 'explicit-config-project');
    const customConfigPath = join(projectRoot, 'custom-config.ts');
    const relativeCustomConfigPath = join('explicit-config-project', 'custom-config.ts');
    const schemaPath = join(projectRoot, 'schema.psl');
    const schemaUri = pathToFileURL(schemaPath).toString();
    const resolvedConfigs: string[] = [];
    const resolveInputs: ResolveInputs = async (_rootPath, configPathArg) => {
      if (configPathArg !== undefined) {
        resolvedConfigs.push(configPathArg);
      }
      return {
        inputs: resolveSchemaInputs({
          contract: {
            source: {
              sourceFormat: 'psl',
              inputs: configPathArg === customConfigPath ? [schemaPath] : [],
            },
          },
        }),
      };
    };
    const failNearestDiscovery: FindConfigPathForFile = async () => {
      throw new Error('nearest config discovery must not run when an explicit config path is set');
    };
    harness = startHarness(resolveInputs, {}, failNearestDiscovery, relativeCustomConfigPath);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });

    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);
    expect(resolvedConfigs).toEqual([customConfigPath]);
  });

  it('publishes no diagnostics for a PSL file that is not a configured input in its project', async () => {
    const projectRoot = join(root, 'non-input-project');
    const projectConfigPath = join(projectRoot, 'prisma-next.config.ts');
    const schemaPath = join(projectRoot, 'schema.psl');
    const otherPath = join(projectRoot, 'other.psl');
    const otherUri = pathToFileURL(otherPath).toString();
    const resolveInputs: ResolveInputs = async () => ({
      inputs: resolveSchemaInputs({
        contract: { source: { sourceFormat: 'psl', inputs: [schemaPath] } },
      }),
    });
    harness = startHarness(
      resolveInputs,
      {},
      findConfigForPrefixes([{ prefix: projectRoot, configPath: projectConfigPath }]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: otherUri, languageId: 'prisma', version: 1, text: 'model {' },
    });

    expect(await harness.waitForDiagnostics(otherUri)).toEqual([]);
  });

  it('does not fall back to a parent config when the nearest config degrades', async () => {
    const parentRoot = join(root, 'parent-project');
    const childRoot = join(parentRoot, 'child-project');
    const parentConfigPath = join(parentRoot, 'prisma-next.config.ts');
    const childConfigPath = join(childRoot, 'prisma-next.config.ts');
    const childSchemaPath = join(childRoot, 'schema.psl');
    const childSchemaUri = pathToFileURL(childSchemaPath).toString();
    const resolvedConfigs: string[] = [];
    const resolveInputs: ResolveInputs = async (_rootPath, configPathArg) => {
      if (configPathArg !== undefined) {
        resolvedConfigs.push(configPathArg);
      }
      if (configPathArg === parentConfigPath) {
        return {
          inputs: resolveSchemaInputs({
            contract: { source: { sourceFormat: 'psl', inputs: [childSchemaPath] } },
          }),
        };
      }
      return { inputs: resolveSchemaInputs({}), degradedReason: 'invalid child config' };
    };
    harness = startHarness(
      resolveInputs,
      {},
      findConfigForPrefixes([{ prefix: childRoot, configPath: childConfigPath }]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: childSchemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });

    expect(await harness.waitForDiagnostics(childSchemaUri)).toEqual([]);
    expect(resolvedConfigs).toEqual([childConfigPath]);
  });

  it('prevents stale initial project loads from overwriting fresher refreshes', async () => {
    const projectRoot = join(root, 'stale-load-project');
    const projectConfigPath = join(projectRoot, 'prisma-next.config.ts');
    const schemaPath = join(projectRoot, 'schema.psl');
    const schemaUri = pathToFileURL(schemaPath).toString();
    const staleInitialLoad = controlledPromise();
    const freshRefresh = controlledPromise();
    let loadCount = 0;
    const resolveInputs: ResolveInputs = async () => {
      loadCount += 1;
      if (loadCount === 1) {
        await staleInitialLoad.promise;
        return {
          inputs: resolveSchemaInputs({
            contract: { source: { sourceFormat: 'psl', inputs: [schemaPath] } },
          }),
        };
      }
      await freshRefresh.promise;
      return { inputs: resolveSchemaInputs({}) };
    };
    harness = startHarness(
      resolveInputs,
      watchedFilesCapabilities,
      findConfigForPrefixes([{ prefix: projectRoot, configPath: projectConfigPath }]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    await waitUntil(() => loadCount === 1);
    harness.notifyConfigChanged(pathToFileURL(projectConfigPath).toString());
    await waitUntil(() => loadCount === 2);

    freshRefresh.resolve();
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    staleInitialLoad.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: 'model {' }],
    });
    expect(
      await harness.waitForDiagnosticsMatching(
        schemaUri,
        (diagnostics) => diagnostics.length === 0,
      ),
    ).toEqual([]);
  });

  it('updates only the project identified by the changed config path', async () => {
    const projectARoot = join(root, 'config-change-a');
    const projectBRoot = join(root, 'config-change-b');
    const projectAConfigPath = join(projectARoot, 'prisma-next.config.ts');
    const projectBConfigPath = join(projectBRoot, 'prisma-next.config.ts');
    const projectASchemaPath = join(projectARoot, 'schema.psl');
    const projectBSchemaPath = join(projectBRoot, 'schema.psl');
    const projectASchemaUri = pathToFileURL(projectASchemaPath).toString();
    const projectBSchemaUri = pathToFileURL(projectBSchemaPath).toString();
    const resolvedConfigs: string[] = [];
    let projectBIsConfigured = true;
    const resolveInputs: ResolveInputs = async (_rootPath, configPathArg) => {
      if (configPathArg !== undefined) {
        resolvedConfigs.push(configPathArg);
      }
      return {
        inputs: resolveSchemaInputs({
          contract: {
            source: {
              sourceFormat: 'psl',
              inputs:
                configPathArg === projectAConfigPath
                  ? [projectASchemaPath]
                  : configPathArg === projectBConfigPath && projectBIsConfigured
                    ? [projectBSchemaPath]
                    : [],
            },
          },
        }),
      };
    };
    harness = startHarness(
      resolveInputs,
      watchedFilesCapabilities,
      findConfigForPrefixes([
        { prefix: projectARoot, configPath: projectAConfigPath },
        { prefix: projectBRoot, configPath: projectBConfigPath },
      ]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: projectASchemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: projectBSchemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    expect((await harness.waitForDiagnostics(projectASchemaUri)).length).toBeGreaterThan(0);
    expect((await harness.waitForDiagnostics(projectBSchemaUri)).length).toBeGreaterThan(0);

    resolvedConfigs.length = 0;
    const projectBCleared = harness.waitForDiagnosticsMatching(
      projectBSchemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    projectBIsConfigured = false;
    harness.notifyConfigChanged(pathToFileURL(projectBConfigPath).toString());

    expect(await projectBCleared).toEqual([]);
    expect(resolvedConfigs).toEqual([projectBConfigPath]);
  });
});

describe('language server config watching', { timeout: timeouts.databaseOperation }, () => {
  it('requests a watched-files registration scoped to the config path', async () => {
    harness = startHarness(resolveToSchema, watchedFilesCapabilities);
    await harness.initialize();
    await harness.waitForWatchedFilesRegistration(timeouts.default);

    const watchedFiles = watchedFilesRegistrations(harness);
    expect(watchedFiles.length).toBe(1);
    expect(JSON.stringify(watchedFiles[0]?.registerOptions)).toContain('prisma-next.config.ts');
  });

  it('does not request registration when the client lacks dynamic registration', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    await harness.waitForWarning((message) =>
      message.includes('does not support dynamic file-watcher registration'),
    );

    expect(watchedFilesRegistrations(harness).length).toBe(0);
  });

  it('starts diagnosing an open doc that a config edit adds as an input', async () => {
    const hook = mutableResolve(resolveToNothing);
    harness = startHarness(hook.resolve, watchedFilesCapabilities);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    const diagnosed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length > 0,
    );
    hook.set(resolveToSchema);
    harness.notifyConfigChanged();
    expect((await diagnosed).length).toBeGreaterThan(0);
  });

  it('clears an open doc that a config edit removes as an input', async () => {
    const hook = mutableResolve(resolveToSchema);
    harness = startHarness(hook.resolve, watchedFilesCapabilities);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);

    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    hook.set(resolveToNothing);
    harness.notifyConfigChanged();
    expect(await cleared).toEqual([]);
  });

  it('begins diagnosing once a previously-degraded config edit makes inputs live', async () => {
    const hook = mutableResolve(resolveDegraded);
    harness = startHarness(hook.resolve, watchedFilesCapabilities);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    const diagnosed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length > 0,
    );
    hook.set(resolveToSchema);
    harness.notifyConfigChanged();
    expect((await diagnosed).length).toBeGreaterThan(0);
  });

  it('degrades gracefully and clears when a config edit breaks the config', async () => {
    const hook = mutableResolve(resolveToSchema);
    harness = startHarness(hook.resolve, watchedFilesCapabilities);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);

    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    hook.set(resolveDegraded);
    harness.notifyConfigChanged();
    expect(await cleared).toEqual([]);
  });
});
