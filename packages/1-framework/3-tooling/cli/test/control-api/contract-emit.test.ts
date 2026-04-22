import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Contract } from '@prisma-next/contract/types';
import type { EmitResult } from '@prisma-next/emitter';
import { emit as emitFn } from '@prisma-next/emitter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as configLoader from '../../src/config-loader';
import { executeContractEmit } from '../../src/control-api/operations/contract-emit';

interface PromiseResolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

declare global {
  interface PromiseConstructor {
    withResolvers<T>(): PromiseResolvers<T>;
  }
}

vi.mock('@prisma-next/emitter', async () => {
  const actual =
    await vi.importActual<typeof import('@prisma-next/emitter')>('@prisma-next/emitter');
  return {
    ...actual,
    emit: vi.fn(),
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

type FsModule = typeof import('node:fs/promises');
type FsWriteFile = FsModule['writeFile'];

const mockedEmit = vi.mocked(emitFn);
const mockedRename = vi.mocked(rename);
const mockedWriteFile = vi.mocked(writeFile);

const stubDescriptor = (kind: string, id: string) => ({
  kind,
  id,
  version: '0.0.1',
});

function mockConfigWithContract(contractOverrides: Record<string, unknown>) {
  return {
    family: stubDescriptor('family', 'test'),
    target: stubDescriptor('target', 'test'),
    contract: contractOverrides,
  } as unknown as Awaited<ReturnType<typeof configLoader.loadConfig>>;
}

function createSourceProvider(load: () => Promise<unknown>): {
  readonly inputs?: readonly string[];
  load: () => Promise<unknown>;
} {
  return {
    load,
  };
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await Promise.resolve();
    }
  }
  throw lastError;
}

function createMockContract(): Contract {
  return {
    capabilities: {},
    extensionPacks: {},
  } as unknown as Contract;
}

function createEmitResult(generation: string): EmitResult {
  return {
    storageHash: `storage-${generation}`,
    profileHash: `profile-${generation}`,
    contractJson: JSON.stringify({ generation }),
    contractDts: `export type Generation = '${generation}';\n`,
  };
}

function createSuccessfulConfig(output: string) {
  const familyInstance = {
    validateContract: vi.fn(),
  };

  return {
    family: {
      id: 'family:test',
      version: '0.0.1',
      familyId: 'test-family',
      emission: {},
      create: () => familyInstance,
    },
    target: {
      kind: 'target',
      id: 'target:test',
      version: '0.0.1',
      familyId: 'test-family',
      targetId: 'test-target',
    },
    adapter: {
      kind: 'adapter',
      id: 'adapter:test',
      version: '0.0.1',
      familyId: 'test-family',
      targetId: 'test-target',
    },
    extensionPacks: [],
    contract: {
      source: createSourceProvider(async () => ({
        ok: true as const,
        value: createMockContract(),
      })),
      output,
    },
  } as unknown as Awaited<ReturnType<typeof configLoader.loadConfig>>;
}

describe('executeContractEmit', () => {
  let tmpDir = '';
  let actualFs: FsModule;

  beforeEach(async () => {
    actualFs = await vi.importActual<FsModule>('node:fs/promises');
    tmpDir = await mkdtemp(join(tmpdir(), 'contract-emit-'));
    mockedEmit.mockReset();
    mockedRename.mockReset();
    mockedWriteFile.mockReset();
    mockedRename.mockImplementation(async (...args) => actualFs.rename(...args));
    mockedWriteFile.mockImplementation(async (...args) => actualFs.writeFile(...args));
  });

  afterEach(async () => {
    if (tmpDir.length > 0) {
      await rm(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  async function withMockedConfig(
    config: Awaited<ReturnType<typeof configLoader.loadConfig>>,
    run: () => Promise<void>,
  ) {
    const loadConfigSpy = vi.spyOn(configLoader, 'loadConfig').mockResolvedValue(config);
    try {
      await run();
    } finally {
      loadConfigSpy.mockRestore();
    }
  }

  it('throws when configPath does not exist', async () => {
    await expect(executeContractEmit({ configPath: '/nonexistent/config.ts' })).rejects.toThrow();
  });

  it('respects signal cancellation before starting', async () => {
    await expect(
      executeContractEmit({
        configPath: 'prisma-next.config.ts',
        signal: AbortSignal.abort(),
      }),
    ).rejects.toSatisfy((error: unknown) => error instanceof Error && error.name === 'AbortError');
  });

  it('preserves AbortError from contract source provider', async () => {
    await withMockedConfig(
      mockConfigWithContract({
        source: createSourceProvider(async () => {
          throw new DOMException('Aborted by test', 'AbortError');
        }),
        output: './src/prisma/contract.json',
      }),
      async () => {
        await expect(
          executeContractEmit({ configPath: 'prisma-next.config.ts' }),
        ).rejects.toSatisfy(
          (error: unknown) => error instanceof Error && error.name === 'AbortError',
        );
      },
    );
  });

  describe.each([
    {
      label: 'rejects non-provider source object',
      source: { invalid: true },
      expectedSubstring: 'valid source provider object',
    },
    {
      label: 'translates provider failure result to runtime error',
      source: createSourceProvider(async () => ({
        ok: false,
        failure: {
          summary: 'Provider parse failed',
          diagnostics: [{ code: 'PSL_PARSE_ERROR', message: 'Unexpected token' }],
          meta: { sourceId: 'schema.prisma' },
        },
      })),
      expectedCode: '3000',
      expectedSubstring: 'Provider parse failed',
    },
    {
      label: 'rejects malformed failure result',
      source: createSourceProvider(async () => ({ ok: false }) as unknown),
      expectedCode: '3000',
      expectedSubstring: 'malformed failure result',
    },
    {
      label: 'rejects malformed success result',
      source: createSourceProvider(async () => ({ ok: true }) as unknown),
      expectedCode: '3000',
      expectedSubstring: 'malformed success result',
    },
  ])('source provider validation', ({ label, source, expectedCode, expectedSubstring }) => {
    it(label, async () => {
      await withMockedConfig(
        mockConfigWithContract({ source, output: './src/prisma/contract.json' }),
        async () => {
          await expect(
            executeContractEmit({ configPath: 'prisma-next.config.ts' }),
          ).rejects.toSatisfy((error: unknown) => {
            if (!(error instanceof Error)) return false;
            const why = (error as { why?: unknown }).why;
            if (typeof why !== 'string' || !why.includes(expectedSubstring)) return false;
            if (expectedCode !== undefined) {
              return (error as { code?: unknown }).code === expectedCode;
            }
            return true;
          });
        },
      );
    });
  });

  it('keeps the newer generation on disk when an older emit finishes later', async () => {
    const outputJsonPath = join(tmpDir, 'src/prisma/contract.json');
    const outputDtsPath = join(tmpDir, 'src/prisma/contract.d.ts');
    const firstEmit = Promise.withResolvers<EmitResult>();
    const secondEmit = Promise.withResolvers<EmitResult>();

    mockedEmit
      .mockImplementationOnce(() => firstEmit.promise)
      .mockImplementationOnce(() => secondEmit.promise);

    await withMockedConfig(createSuccessfulConfig(outputJsonPath), async () => {
      const first = executeContractEmit({ configPath: join(tmpDir, 'prisma-next.config.ts') });
      const second = executeContractEmit({ configPath: join(tmpDir, 'prisma-next.config.ts') });

      await eventually(() => {
        expect(mockedEmit).toHaveBeenCalledTimes(2);
      });

      secondEmit.resolve(createEmitResult('newer'));
      const secondResult = await second;

      firstEmit.resolve(createEmitResult('older'));
      const firstResult = await first;

      expect(secondResult.publication).toBe('written');
      expect(firstResult.publication).toBe('superseded');
    });

    expect(await readFile(outputJsonPath, 'utf-8')).toBe(JSON.stringify({ generation: 'newer' }));
    expect(await readFile(outputDtsPath, 'utf-8')).toBe("export type Generation = 'newer';\n");
  });

  it('keeps the last good artifacts when a newer request fails after superseding an older emit', async () => {
    const outputJsonPath = join(tmpDir, 'src/prisma/contract.json');
    const outputDtsPath = join(tmpDir, 'src/prisma/contract.d.ts');
    const previousJson = JSON.stringify({ generation: 'previous' });
    const previousDts = "export type Generation = 'previous';\n";
    const firstEmit = Promise.withResolvers<EmitResult>();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await mkdir(join(tmpDir, 'src/prisma'), { recursive: true });
    await writeFile(outputJsonPath, previousJson, 'utf-8');
    await writeFile(outputDtsPath, previousDts, 'utf-8');

    mockedEmit
      .mockImplementationOnce(() => firstEmit.promise)
      .mockResolvedValueOnce(createEmitResult('newer'));

    mockedWriteFile.mockImplementation(async (...args: Parameters<FsWriteFile>) => {
      const [path] = args;
      if (String(path).includes('.2.next.tmp')) {
        throw new Error('simulated newer generation write failure');
      }
      return actualFs.writeFile(...args);
    });

    await withMockedConfig(createSuccessfulConfig(outputJsonPath), async () => {
      const first = executeContractEmit({ configPath: join(tmpDir, 'prisma-next.config.ts') });
      const second = executeContractEmit({ configPath: join(tmpDir, 'prisma-next.config.ts') });

      await eventually(() => {
        expect(mockedEmit).toHaveBeenCalledTimes(2);
      });

      await expect(second).rejects.toThrow('simulated newer generation write failure');

      firstEmit.resolve({
        ...createEmitResult('older'),
        contractDts: [
          "import type { Missing } from '@example/missing-types';",
          "export type Generation = 'older';",
          '',
        ].join('\n'),
      });
      const firstResult = await first;
      expect(firstResult.publication).toBe('superseded');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    expect(await readFile(outputJsonPath, 'utf-8')).toBe(previousJson);
    expect(await readFile(outputDtsPath, 'utf-8')).toBe(previousDts);
  });
});
