import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import type { AuthoringPslBlockDescriptorNamespace } from '@prisma-next/framework-components/authoring';
import { buildSymbolTable, type SymbolTable } from '@prisma-next/psl-parser';
import type { FormatOptions } from '@prisma-next/psl-parser/format';
import { type ParseDiagnostic, parse } from '@prisma-next/psl-parser/syntax';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ClientCapabilities,
  type CompletionItem,
  type CompletionList,
  CompletionRequest,
  createConnection,
  type Diagnostic,
  DiagnosticSeverity,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentFormattingRequest,
  FileChangeType,
  InitializedNotification,
  InitializeRequest,
  type InitializeResult,
  InsertTextFormat,
  LogMessageNotification,
  MessageType,
  type Position,
  PublishDiagnosticsNotification,
  type RegistrationParams,
  RegistrationRequest,
  StreamMessageReader,
  StreamMessageWriter,
  type TextEdit,
} from 'vscode-languageserver/node';
import type { ConfigResolution } from '../src/config-resolution';
import type { CachedDocument } from '../src/project-artifacts';
import { resolveSchemaInputs } from '../src/schema-inputs';
import { createServer } from '../src/server';

type ResolveInputs = (configPath: string) => Promise<ConfigResolution>;
type FindNearestConfigPathForFile = (filePath: string) => Promise<string | undefined>;

interface ConfigResolutionWithFormatter extends ConfigResolution {
  readonly formatter?: FormatOptions;
}

const configLoaderMock = vi.hoisted(() => ({
  findNearestConfigPathForFile: vi.fn<FindNearestConfigPathForFile>(),
}));
const configResolutionMock = vi.hoisted(() => ({
  resolveConfigInputs: vi.fn<ResolveInputs>(),
}));

vi.mock('@prisma-next/config-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma-next/config-loader')>();
  return {
    ...actual,
    findNearestConfigPathForFile: configLoaderMock.findNearestConfigPathForFile,
  };
});

vi.mock('../src/config-resolution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config-resolution')>();
  return { ...actual, resolveConfigInputs: configResolutionMock.resolveConfigInputs };
});

const root = tmpdir();
const schemaPath = join(root, 'schema.psl');
const schemaUri = pathToFileURL(schemaPath).toString();
const configPath = join(root, 'prisma-next.config.ts');
const configUri = pathToFileURL(configPath).toString();
const unformattedPsl = 'model User {\nid Int\n}';
const formattedPsl = 'model User {\n  id Int\n}\n';

const scalarTypes = ['String', 'Int', 'Boolean', 'DateTime'] as const;
const nameSnippetPlaceholder = '$' + '{1:Name}';

const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  policy: {
    kind: 'pslBlock',
    keyword: 'policy',
    discriminator: 'fixture-policy',
    name: { required: true },
    parameters: {
      on: { kind: 'ref', refKind: 'model', scope: 'same-space' },
      where: { kind: 'value', codecId: 'fixture/text@1' },
      mode: { kind: 'option', values: ['permissive', 'restrictive'] },
    },
  },
};

function resolutionForInputs(
  inputs: readonly string[],
  formatter?: FormatOptions,
  descriptors: AuthoringPslBlockDescriptorNamespace = {},
): ConfigResolutionWithFormatter {
  const resolution = {
    inputs: resolveSchemaInputs({
      contract: { source: { sourceFormat: 'psl', inputs } },
    }),
    controlStack: { scalarTypes: [...scalarTypes], pslBlockDescriptors: descriptors },
  };
  return formatter === undefined ? resolution : { ...resolution, formatter };
}

function emptyResolution(): ConfigResolution {
  return {
    inputs: resolveSchemaInputs({}),
    controlStack: { scalarTypes: [...scalarTypes], pslBlockDescriptors: {} },
  };
}

const resolveToSchema: ResolveInputs = async () => resolutionForInputs([schemaPath]);
const resolveToSchemaWithPslBlockDescriptors: ResolveInputs = async () =>
  resolutionForInputs([schemaPath], undefined, pslBlockDescriptors);

function resolveToSchemaWithFormatter(formatter: FormatOptions): ResolveInputs {
  return async () => resolutionForInputs([schemaPath], formatter);
}

// Mirrors the server's LSP framing of a `ParseDiagnostic` (see `publish`):
// the symbol-table tier is published with the same shape as the parse tier.
function toPublishedDiagnostics(diagnostics: readonly ParseDiagnostic[]): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({
    range: diagnostic.range,
    message: diagnostic.message,
    code: diagnostic.code,
    severity: DiagnosticSeverity.Error,
    source: 'prisma-next',
  }));
}

function parseAndSymbolTableDiagnostics(source: string): {
  readonly parseDiagnostics: readonly ParseDiagnostic[];
  readonly symbolTableDiagnostics: readonly ParseDiagnostic[];
} {
  const { document, sourceFile, diagnostics: parseDiagnostics } = parse(source);
  const { diagnostics: symbolTableDiagnostics } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes: [...scalarTypes],
    pslBlockDescriptors: {},
  });
  return { parseDiagnostics, symbolTableDiagnostics };
}

const watchedFilesCapabilities: ClientCapabilities = {
  workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
};

const snippetCompletionCapabilities: ClientCapabilities = {
  textDocument: { completion: { completionItem: { snippetSupport: true } } },
};

interface Harness {
  readonly client: ReturnType<typeof createConnection>;
  readonly initialize: () => Promise<InitializeResult>;
  readonly waitForDiagnostics: (uri: string) => Promise<readonly Diagnostic[]>;
  readonly waitForDiagnosticsMatching: (
    uri: string,
    predicate: (diagnostics: readonly Diagnostic[]) => boolean,
  ) => Promise<readonly Diagnostic[]>;
  readonly waitForDiagnosticsCount: (uri: string, count: number) => Promise<void>;
  readonly registrations: RegistrationParams[];
  readonly waitForWatchedFilesRegistration: (timeoutMs: number) => Promise<void>;
  readonly waitForWarning: (predicate: (message: string) => boolean) => Promise<string>;
  readonly latestDiagnostics: (uri: string) => readonly Diagnostic[] | undefined;
  readonly notifyConfigChanged: (uri?: string) => void;
  readonly getDocumentAst: (uri: string) => CachedDocument | undefined;
  readonly getProjectSymbolTable: (uri: string) => SymbolTable | undefined;
  dispose: () => void;
}

function startHarness(
  resolveInputs: ResolveInputs,
  capabilities: ClientCapabilities = {},
  findNearestConfigPathForFile: FindNearestConfigPathForFile = async () => configPath,
): Harness {
  configResolutionMock.resolveConfigInputs.mockImplementation(resolveInputs);
  configLoaderMock.findNearestConfigPathForFile.mockImplementation(findNearestConfigPathForFile);
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();

  const serverConnection = createConnection(
    new StreamMessageReader(clientToServer),
    new StreamMessageWriter(serverToClient),
  );
  const server = createServer(serverConnection);

  const client = createConnection(
    new StreamMessageReader(serverToClient),
    new StreamMessageWriter(clientToServer),
  );

  const pending = new Map<string, (diagnostics: readonly Diagnostic[]) => void>();
  const latest = new Map<string, readonly Diagnostic[]>();
  const publishCounts = new Map<string, number>();
  interface PredicateWaiter {
    readonly predicate: (diagnostics: readonly Diagnostic[]) => boolean;
    readonly resolve: (diagnostics: readonly Diagnostic[]) => void;
  }
  const predicateWaiters = new Map<string, PredicateWaiter[]>();
  interface CountWaiter {
    readonly count: number;
    readonly resolve: () => void;
  }
  const countWaiters = new Map<string, CountWaiter[]>();
  client.onNotification(PublishDiagnosticsNotification.type, (params) => {
    latest.set(params.uri, params.diagnostics);
    const publishCount = (publishCounts.get(params.uri) ?? 0) + 1;
    publishCounts.set(params.uri, publishCount);
    pending.get(params.uri)?.(params.diagnostics);
    const countQueue = countWaiters.get(params.uri);
    if (countQueue) {
      const remaining = countQueue.filter((waiter) => {
        if (publishCount >= waiter.count) {
          waiter.resolve();
          return false;
        }
        return true;
      });
      countWaiters.set(params.uri, remaining);
    }
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
    latestDiagnostics: (uri) => latest.get(uri),
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
    waitForDiagnosticsCount: (uri, count) =>
      new Promise((resolve) => {
        if ((publishCounts.get(uri) ?? 0) >= count) {
          resolve();
          return;
        }
        const queue = countWaiters.get(uri) ?? [];
        queue.push({ count, resolve });
        countWaiters.set(uri, queue);
      }),
    notifyConfigChanged: (uri = configUri) => {
      client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri, type: FileChangeType.Changed }],
      });
    },
    getDocumentAst: (uri) => server.getDocumentAst(uri),
    getProjectSymbolTable: (uri) => server.getProjectSymbolTable(uri),
    dispose: () => {
      client.dispose();
      server.dispose();
      clientToServer.end();
      serverToClient.end();
    },
  };
}

function openDocument(harness: Harness, uri: string, text: string, version = 1): void {
  harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
    textDocument: { uri, languageId: 'prisma', version, text },
  });
}

function closeDocument(harness: Harness, uri: string): void {
  harness.client.sendNotification(DidCloseTextDocumentNotification.type, {
    textDocument: { uri },
  });
}

function requestFormatting(harness: Harness, uri: string): Promise<TextEdit[] | null> {
  return harness.client.sendRequest(DocumentFormattingRequest.type, {
    textDocument: { uri },
    options: { tabSize: 2, insertSpaces: true },
  });
}

function requestCompletion(
  harness: Harness,
  uri: string,
  position: Position,
): Promise<CompletionItem[] | CompletionList | null> {
  return harness.client.sendRequest(CompletionRequest.type, {
    textDocument: { uri },
    position,
  });
}

function completionItems(
  result: CompletionItem[] | CompletionList | null,
): readonly CompletionItem[] {
  if (result === null) {
    return [];
  }
  return Array.isArray(result) ? result : result.items;
}

function sourceWithCursor(markedSource: string): {
  readonly source: string;
  readonly position: Position;
} {
  const cursorOffset = markedSource.indexOf('|');
  if (cursorOffset < 0) {
    throw new Error('Missing cursor marker');
  }
  const prefix = markedSource.slice(0, cursorOffset);
  const source = `${prefix}${markedSource.slice(cursorOffset + 1)}`;
  const lines = prefix.split('\n');
  return {
    source,
    position: { line: lines.length - 1, character: (lines[lines.length - 1] ?? '').length },
  };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

let harness: Harness | undefined;

afterEach(async () => {
  // Let any in-flight JSON-RPC writes settle before tearing the streams down,
  // so disposing the connections doesn't reject a notification mid-transmission.
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness?.dispose();
  harness = undefined;
  configResolutionMock.resolveConfigInputs.mockReset();
  configLoaderMock.findNearestConfigPathForFile.mockReset();
});

describe('language server', { timeout: timeouts.databaseOperation }, () => {
  it('answers initialize and advertises text-document sync plus completion support', async () => {
    harness = startHarness(resolveToSchema);
    const result = await harness.initialize();
    expect(result.capabilities.textDocumentSync).toBeDefined();
    expect(result.capabilities.documentFormattingProvider).toBe(true);
    expect(result.capabilities.completionProvider).toEqual({ triggerCharacters: ['.'] });
  });

  it('returns model field type completions for configured PSL inputs', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const { source, position } = sourceWithCursor(
      [
        'model User {',
        '  id Int @id',
        '}',
        '',
        'type Address {',
        '  street String',
        '}',
        '',
        'model Post {',
        '  id Int @id',
        '  author |',
        '}',
      ].join('\n'),
    );
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items.map((item) => item.label)).toEqual([
      'Boolean',
      'DateTime',
      'Int',
      'String',
      'Post',
      'User',
      'Address',
    ]);
  });

  it('refreshes completion artifacts from the current buffer before classifying', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const initial = ['model Post {', '  author |', '}'].join('\n');
    const updated = sourceWithCursor(
      ['model User {', '  id Int @id', '}', '', 'model Post {', '  author U|', '}'].join('\n'),
    );
    openDocument(harness, schemaUri, initial);
    await harness.waitForDiagnostics(schemaUri);
    await harness.waitForDiagnosticsCount(schemaUri, 2);

    const republished = harness.waitForDiagnosticsCount(schemaUri, 3);
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [{ text: updated.source }],
    });

    const items = completionItems(await requestCompletion(harness, schemaUri, updated.position));
    expect(items.map((item) => item.label)).toEqual(['User']);
    await republished;
  });

  it('returns generic block parameter completions for configured PSL descriptors', async () => {
    harness = startHarness(resolveToSchemaWithPslBlockDescriptors);
    await harness.initialize();
    const { source, position } = sourceWithCursor(['policy UserAccess {', '  wh|', '}'].join('\n'));
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items.map((item) => item.label)).toEqual(['where']);
  });

  it('returns declaration keyword completions with plain-text edits by default', async () => {
    harness = startHarness(resolveToSchemaWithPslBlockDescriptors);
    await harness.initialize();
    const { source, position } = sourceWithCursor('|');
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items.map((item) => item.label)).toEqual([
      'model',
      'type',
      'types',
      'namespace',
      'policy',
    ]);
    expect(items.find((item) => item.label === 'model')).toMatchObject({
      textEdit: { newText: 'model ' },
    });
    expect(items.find((item) => item.label === 'model')?.insertTextFormat).toBeUndefined();
  });

  it('returns declaration keyword snippets when the client supports snippets', async () => {
    harness = startHarness(resolveToSchemaWithPslBlockDescriptors, snippetCompletionCapabilities);
    await harness.initialize();
    const { source, position } = sourceWithCursor('|');
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items.find((item) => item.label === 'model')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `model ${nameSnippetPlaceholder} {\n  $0\n}` },
    });
    expect(items.find((item) => item.label === 'policy')).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { newText: `policy ${nameSnippetPlaceholder} {\n  $0\n}` },
    });
  });

  it('returns namespace-body declaration keywords without document-only keywords', async () => {
    harness = startHarness(resolveToSchemaWithPslBlockDescriptors);
    await harness.initialize();
    const { source, position } = sourceWithCursor(['namespace feature {', '  |', '}'].join('\n'));
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items.map((item) => item.label)).toEqual(['model', 'type', 'policy']);
    expect(items.map((item) => item.label)).not.toContain('types');
    expect(items.map((item) => item.label)).not.toContain('namespace');
  });

  it('returns no completion items for unconfigured PSL documents', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    const { source, position } = sourceWithCursor(
      ['model User {', '  id Int @id', '}', '', 'model Post {', '  author |', '}'].join('\n'),
    );
    openDocument(harness, otherUri, source);
    expect(await harness.waitForDiagnostics(otherUri)).toEqual([]);

    const items = completionItems(await requestCompletion(harness, otherUri, position));
    expect(items).toEqual([]);
  });

  it('returns no completion items for ordinary field attribute contexts', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const { source, position } = sourceWithCursor(['model User {', '  id Int @|', '}'].join('\n'));
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items).toEqual([]);
  });

  it('returns no completion items for ordinary model attribute contexts', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const { source, position } = sourceWithCursor(
      ['model User {', '  id Int @id', '  @@|', '}'].join('\n'),
    );
    openDocument(harness, schemaUri, source);
    await harness.waitForDiagnostics(schemaUri);

    const items = completionItems(await requestCompletion(harness, schemaUri, position));
    expect(items).toEqual([]);
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

  it('does not publish diagnostics when config resolution fails', async () => {
    harness = startHarness(resolveFails);
    const result = await harness.initialize();
    expect(result).toBeDefined();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    await waitUntil(() => configResolutionMock.resolveConfigInputs.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.latestDiagnostics(schemaUri)).toBeUndefined();
  });

  it('formats a configured PSL input with one whole-document edit', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, unformattedPsl);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
        newText: formattedPsl,
      },
    ]);
  });

  it('returns no edits for canonical PSL input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, formattedPsl);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([]);
  });

  it('returns no edits for unconfigured PSL documents', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    openDocument(harness, otherUri, unformattedPsl);
    expect(await harness.waitForDiagnostics(otherUri)).toEqual([]);

    await expect(requestFormatting(harness, otherUri)).resolves.toEqual([]);
  });

  it('returns no edits for malformed PSL', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    openDocument(harness, schemaUri, 'model {');
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);

    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([]);
  });

  it('returns no edits for missing and closed documents', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();
    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([]);

    openDocument(harness, schemaUri, unformattedPsl);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);
    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    closeDocument(harness, schemaUri);
    expect(await cleared).toEqual([]);
    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([]);
  });

  it('uses Prisma config formatter options', async () => {
    harness = startHarness(resolveToSchemaWithFormatter({ indent: 'tab', newline: 'CRLF' }));
    await harness.initialize();
    openDocument(harness, schemaUri, unformattedPsl);
    expect(await harness.waitForDiagnostics(schemaUri)).toEqual([]);

    await expect(requestFormatting(harness, schemaUri)).resolves.toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
        newText: 'model User {\r\n\tid Int\r\n}\r\n',
      },
    ]);
  });
});

const duplicateModelSource = [
  'model User {',
  '  id Int @id',
  '}',
  '',
  'model User {',
  '  id Int @id',
  '}',
].join('\n');

describe('language server symbol-table diagnostics', {
  timeout: timeouts.databaseOperation,
}, () => {
  it('publishes a PSL_DUPLICATE_DECLARATION diagnostic for a duplicate top-level declaration', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: duplicateModelSource,
      },
    });

    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('PSL_DUPLICATE_DECLARATION');
  });

  it('publishes a PSL_INVALID_QUALIFIED_TYPE diagnostic for an over-qualified field type', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    const source = ['model Profile {', '  user a.b.c', '}'].join('\n');
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: source },
    });

    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'PSL_INVALID_QUALIFIED_TYPE',
    );
  });

  it('clears the symbol-table diagnostic once an edit fixes the document', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: duplicateModelSource,
      },
    });
    const broken = await harness.waitForDiagnostics(schemaUri);
    expect(broken.map((diagnostic) => diagnostic.code)).toContain('PSL_DUPLICATE_DECLARATION');

    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [
        { text: 'model User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n' },
      ],
    });
    expect(await cleared).toEqual([]);
  });

  it('publishes an empty set for a clean configured PSL input with the symbol-table tier active', async () => {
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

  it('publishes diagnostics matching parse + buildSymbolTable for the same inputs (build parity)', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    const source = [
      'model Profile {',
      '  user a.b.c',
      '}',
      '',
      'model Profile {',
      '  id Int @id',
      '}',
    ].join('\n');
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: source },
    });

    const published = await harness.waitForDiagnostics(schemaUri);
    const { parseDiagnostics, symbolTableDiagnostics } = parseAndSymbolTableDiagnostics(source);

    expect(published).toEqual(
      toPublishedDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
    );
  });

  it('orders parse diagnostics ahead of symbol-table diagnostics regardless of source position', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    // The unterminated `model Dangling` (a parse-tier diagnostic) sits *after*
    // the duplicate `model User` (a symbol-table-tier diagnostic) in the source,
    // so a stable parse-then-symbol-table merge must reorder them on publish.
    const source = [
      'model User {',
      '  id Int @id',
      '}',
      '',
      'model User {',
      '  id Int @id',
      '}',
      '',
      'model Dangling {',
      '  id Int',
    ].join('\n');
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: source },
    });

    const published = await harness.waitForDiagnostics(schemaUri);
    const { parseDiagnostics, symbolTableDiagnostics } = parseAndSymbolTableDiagnostics(source);

    expect(parseDiagnostics.length).toBeGreaterThan(0);
    expect(symbolTableDiagnostics.length).toBeGreaterThan(0);
    expect(published).toEqual(
      toPublishedDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
    );
    // The first published diagnostic (parse tier) lies on a later line than the
    // second (symbol-table tier): ordering is by tier, not by source position.
    expect(published[0]?.range.start.line ?? 0).toBeGreaterThan(
      published[1]?.range.start.line ?? 0,
    );
  });

  it('does not crash on a malformed buffer and still publishes a diagnostic set', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: 'model User {\n  id ',
      },
    });

    const diagnostics = await harness.waitForDiagnostics(schemaUri);
    expect(Array.isArray(diagnostics)).toBe(true);
  });

  it('publishes an empty set for a document that is not a configured input', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    const otherUri = pathToFileURL(join(root, 'not-a-schema.psl')).toString();
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: otherUri, languageId: 'prisma', version: 1, text: duplicateModelSource },
    });

    const diagnostics = await harness.waitForDiagnostics(otherUri);
    expect(diagnostics).toEqual([]);
  });
});

function mutableResolve(initial: ResolveInputs): {
  resolve: ResolveInputs;
  set: (next: ResolveInputs) => void;
} {
  let current = initial;
  return {
    resolve: (configPath) => current(configPath),
    set: (next) => {
      current = next;
    },
  };
}

const resolveToNothing: ResolveInputs = async () => emptyResolution();

const resolveFails: ResolveInputs = async () => {
  throw new Error('config failed');
};

function watchedFilesRegistrations(harness: Harness) {
  return harness.registrations
    .flatMap((params) => params.registrations)
    .filter((registration) => registration.method === 'workspace/didChangeWatchedFiles');
}

function findNearestConfigForPrefixes(
  entries: readonly { readonly prefix: string; readonly configPath: string }[],
): FindNearestConfigPathForFile {
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
    const resolveInputs: ResolveInputs = async (configPath) => {
      resolvedConfigs.push(configPath);
      return resolutionForInputs(
        configPath === projectAConfigPath
          ? [projectASchemaPath]
          : configPath === projectBConfigPath
            ? [projectBSchemaPath]
            : [],
      );
    };
    harness = startHarness(
      resolveInputs,
      {},
      findNearestConfigForPrefixes([
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
    const resolveInputs: ResolveInputs = async (configPath) => {
      resolvedConfigs.push(configPath);
      return resolutionForInputs(configPath === unseenConfigPath ? [unseenSchemaPath] : []);
    };
    harness = startHarness(
      resolveInputs,
      {},
      findNearestConfigForPrefixes([{ prefix: unseenRoot, configPath: unseenConfigPath }]),
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

  it('publishes no diagnostics for a PSL file that is not a configured input in its project', async () => {
    const projectRoot = join(root, 'non-input-project');
    const projectConfigPath = join(projectRoot, 'prisma-next.config.ts');
    const schemaPath = join(projectRoot, 'schema.psl');
    const otherPath = join(projectRoot, 'other.psl');
    const otherUri = pathToFileURL(otherPath).toString();
    const resolveInputs: ResolveInputs = async () => resolutionForInputs([schemaPath]);
    harness = startHarness(
      resolveInputs,
      {},
      findNearestConfigForPrefixes([{ prefix: projectRoot, configPath: projectConfigPath }]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: otherUri, languageId: 'prisma', version: 1, text: 'model {' },
    });

    expect(await harness.waitForDiagnostics(otherUri)).toEqual([]);
  });

  it('does not fall back to a parent config when the nearest config fails to load', async () => {
    const parentRoot = join(root, 'parent-project');
    const childRoot = join(parentRoot, 'child-project');
    const parentConfigPath = join(parentRoot, 'prisma-next.config.ts');
    const childConfigPath = join(childRoot, 'prisma-next.config.ts');
    const childSchemaPath = join(childRoot, 'schema.psl');
    const childSchemaUri = pathToFileURL(childSchemaPath).toString();
    const resolvedConfigs: string[] = [];
    const resolveInputs: ResolveInputs = async (configPath) => {
      resolvedConfigs.push(configPath);
      if (configPath === parentConfigPath) {
        return resolutionForInputs([childSchemaPath]);
      }
      throw new Error('invalid child config');
    };
    harness = startHarness(
      resolveInputs,
      {},
      findNearestConfigForPrefixes([{ prefix: childRoot, configPath: childConfigPath }]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: childSchemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });

    await waitUntil(() => resolvedConfigs.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.latestDiagnostics(childSchemaUri)).toBeUndefined();
    expect(resolvedConfigs).toEqual([childConfigPath]);
  });

  it('queues project refreshes behind in-flight project loads', async () => {
    const projectRoot = join(root, 'queued-load-project');
    const projectConfigPath = join(projectRoot, 'prisma-next.config.ts');
    const schemaPath = join(projectRoot, 'schema.psl');
    const schemaUri = pathToFileURL(schemaPath).toString();
    const initialLoad = controlledPromise();
    const refreshLoad = controlledPromise();
    let loadCount = 0;
    const resolveInputs: ResolveInputs = async () => {
      loadCount += 1;
      if (loadCount === 1) {
        await initialLoad.promise;
        return resolutionForInputs([schemaPath]);
      }
      await refreshLoad.promise;
      return emptyResolution();
    };
    harness = startHarness(
      resolveInputs,
      watchedFilesCapabilities,
      findNearestConfigForPrefixes([{ prefix: projectRoot, configPath: projectConfigPath }]),
    );
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    await waitUntil(() => loadCount === 1);
    harness.notifyConfigChanged(pathToFileURL(projectConfigPath).toString());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadCount).toBe(1);

    initialLoad.resolve();
    await waitUntil(() => loadCount === 2);
    refreshLoad.resolve();

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
    const resolveInputs: ResolveInputs = async (configPath) => {
      resolvedConfigs.push(configPath);
      return resolutionForInputs(
        configPath === projectAConfigPath
          ? [projectASchemaPath]
          : configPath === projectBConfigPath && projectBIsConfigured
            ? [projectBSchemaPath]
            : [],
      );
    };
    harness = startHarness(
      resolveInputs,
      watchedFilesCapabilities,
      findNearestConfigForPrefixes([
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

  it('begins diagnosing once a previously unloadable config edit makes inputs live', async () => {
    const hook = mutableResolve(resolveFails);
    harness = startHarness(hook.resolve, watchedFilesCapabilities);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, languageId: 'prisma', version: 1, text: 'model {' },
    });
    await waitUntil(() => configResolutionMock.resolveConfigInputs.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.latestDiagnostics(schemaUri)).toBeUndefined();

    const diagnosed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length > 0,
    );
    hook.set(resolveToSchema);
    harness.notifyConfigChanged();
    expect((await diagnosed).length).toBeGreaterThan(0);
  });

  it('stops managing a project when a config edit breaks the config', async () => {
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
    hook.set(resolveFails);
    harness.notifyConfigChanged();
    expect(await cleared).toEqual([]);
  });
});

describe('language server preserved artifacts', { timeout: timeouts.databaseOperation }, () => {
  it('replaces the cached AST per URI on each edit while one symbol table tracks the project', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: duplicateModelSource,
      },
    });
    const broken = await harness.waitForDiagnostics(schemaUri);
    expect(broken.map((diagnostic) => diagnostic.code)).toContain('PSL_DUPLICATE_DECLARATION');
    const firstAst = harness.getDocumentAst(schemaUri);
    expect(firstAst?.document).toBeDefined();

    const cleared = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    harness.client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri: schemaUri, version: 2 },
      contentChanges: [
        { text: 'model User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n' },
      ],
    });
    await cleared;

    const secondAst = harness.getDocumentAst(schemaUri);
    expect(secondAst?.document).not.toBe(firstAst?.document);
    expect(Object.keys(harness.getProjectSymbolTable(schemaUri)?.topLevel.models ?? {})).toEqual(
      expect.arrayContaining(['User', 'Post']),
    );
  });

  it('ignores a publish that resolves after the document closes', async () => {
    const load = deferred<ConfigResolution>();
    harness = startHarness(async () => load.promise);
    await harness.initialize();

    openDocument(harness, schemaUri, duplicateModelSource);
    const closed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    closeDocument(harness, schemaUri);
    await closed;

    load.resolve(resolutionForInputs([schemaPath]));
    await requestFormatting(harness, schemaUri);

    expect(harness.latestDiagnostics(schemaUri)).toEqual([]);
    expect(harness.getDocumentAst(schemaUri)).toBeUndefined();
    expect(harness.getProjectSymbolTable(schemaUri)).toBeUndefined();
  });

  it('rediscovers document ownership after close', async () => {
    const alternateConfigPath = join(root, 'alternate-prisma-next.config.ts');
    let nearestConfigPath = configPath;
    harness = startHarness(
      async (path) => (path === configPath ? resolutionForInputs([schemaPath]) : emptyResolution()),
      {},
      async () => nearestConfigPath,
    );
    await harness.initialize();

    openDocument(harness, schemaUri, duplicateModelSource);
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);

    const closed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    closeDocument(harness, schemaUri);
    await closed;

    nearestConfigPath = alternateConfigPath;
    const reopened = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    openDocument(harness, schemaUri, duplicateModelSource, 2);
    await reopened;

    expect(configResolutionMock.resolveConfigInputs).toHaveBeenCalledWith(alternateConfigPath);
  });

  it('drops the cached AST and clears the symbol table when the document closes', async () => {
    harness = startHarness(resolveToSchema);
    await harness.initialize();

    // Open with a diagnostic-producing source so the only empty publish is the
    // close's clear: an `onDidOpen` + `onDidChangeContent` pair both fire on open,
    // so a clean source would publish `[]` twice and resolve the waiter early.
    harness.client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: schemaUri,
        languageId: 'prisma',
        version: 1,
        text: duplicateModelSource,
      },
    });
    expect((await harness.waitForDiagnostics(schemaUri)).length).toBeGreaterThan(0);
    expect(harness.getDocumentAst(schemaUri)).toBeDefined();
    expect(harness.getProjectSymbolTable(schemaUri)).toBeDefined();
    await harness.waitForDiagnosticsCount(schemaUri, 2);

    const closed = harness.waitForDiagnosticsMatching(
      schemaUri,
      (diagnostics) => diagnostics.length === 0,
    );
    harness.client.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri: schemaUri },
    });
    await closed;

    expect(harness.getDocumentAst(schemaUri)).toBeUndefined();
    expect(harness.getProjectSymbolTable(schemaUri)).toBeUndefined();
  });
});
