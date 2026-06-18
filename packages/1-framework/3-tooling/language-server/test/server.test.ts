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

const root = tmpdir();
const schemaPath = join(root, 'schema.psl');
const schemaUri = pathToFileURL(schemaPath).toString();
const configPath = join(root, 'prisma-next.config.ts');
const configUri = pathToFileURL(configPath).toString();

const resolveToSchema: ResolveInputs = async () => ({
  inputs: resolveSchemaInputs({
    contract: { source: { inputs: [schemaPath] } },
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
  readonly notifyConfigChanged: () => void;
  dispose: () => void;
}

function startHarness(
  resolveInputs: ResolveInputs,
  capabilities: ClientCapabilities = {},
): Harness {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();

  const serverConnection = createConnection(
    new StreamMessageReader(clientToServer),
    new StreamMessageWriter(serverToClient),
  );
  const server = createServer(serverConnection, { resolveInputs });

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
    notifyConfigChanged: () => {
      client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri: configUri, type: FileChangeType.Changed }],
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
