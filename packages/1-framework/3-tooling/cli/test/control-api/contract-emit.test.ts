import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Contract } from '@prisma-next/contract/types';
import type { EmitResult } from '@prisma-next/emitter';
import { emit as emitFn } from '@prisma-next/emitter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as configLoader from '../../src/config-loader';
import { executeContractEmit } from '../../src/control-api/operations/contract-emit';

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

type FsWriteFile = typeof import('node:fs/promises')['writeFile'];

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
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

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'contract-emit-'));
    mockedEmit.mockReset();
    mockedRename.mockReset();
    mockedWriteFile.mockReset();

    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    mockedRename.mockImplementation(async (...args: Parameters<typeof rename>) =>
      actualFs.rename(...args),
    );
    mockedWriteFile.mockImplementation(async (...args: Parameters<FsWriteFile>) =>
      actualFs.writeFile(...args),
    );
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

  it('throws when contract source is not a valid provider object', async () => {
    await withMockedConfig(
      mockConfigWithContract({
        source: { invalid: true },
        output: './src/prisma/contract.json',
      }),
      async () => {
        await expect(
          executeContractEmit({ configPath: 'prisma-next.config.ts' }),
        ).rejects.toSatisfy(
          (error: unknown) =>
            error instanceof Error &&
            'why' in error &&
            typeof error.why === 'string' &&
            error.why.includes('valid source provider object'),
        );
      },
    );
  });

  it('throws runtime error when contract source provider returns failure result', async () => {
    await withMockedConfig(
      mockConfigWithContract({
        source: createSourceProvider(async () => ({
          ok: false,
          failure: {
            summary: 'Provider parse failed',
            diagnostics: [{ code: 'PSL_PARSE_ERROR', message: 'Unexpected token' }],
            meta: { sourceId: 'schema.prisma' },
          },
        })),
        output: './src/prisma/contract.json',
      }),
      async () => {
        await expect(
          executeContractEmit({ configPath: 'prisma-next.config.ts' }),
        ).rejects.toSatisfy(
          (error: unknown) =>
            error instanceof Error &&
            'code' in error &&
            error.code === '3000' &&
            'why' in error &&
            typeof error.why === 'string' &&
            error.why.includes('Provider parse failed'),
        );
      },
    );
  });

  it('throws runtime error when contract source provider returns malformed failure result', async () => {
    await withMockedConfig(
      mockConfigWithContract({
        source: createSourceProvider(
          async () =>
            ({
              ok: false,
            }) as unknown,
        ),
        output: './src/prisma/contract.json',
      }),
      async () => {
        await expect(
          executeContractEmit({ configPath: 'prisma-next.config.ts' }),
        ).rejects.toSatisfy(
          (error: unknown) =>
            error instanceof Error &&
            'code' in error &&
            error.code === '3000' &&
            'why' in error &&
            typeof error.why === 'string' &&
            error.why.includes('malformed failure result'),
        );
      },
    );
  });

  it('throws runtime error when contract source provider returns malformed success result', async () => {
    await withMockedConfig(
      mockConfigWithContract({
        source: createSourceProvider(
          async () =>
            ({
              ok: true,
            }) as unknown,
        ),
        output: './src/prisma/contract.json',
      }),
      async () => {
        await expect(
          executeContractEmit({ configPath: 'prisma-next.config.ts' }),
        ).rejects.toSatisfy(
          (error: unknown) =>
            error instanceof Error &&
            'code' in error &&
            error.code === '3000' &&
            'why' in error &&
            typeof error.why === 'string' &&
            error.why.includes('malformed success result'),
        );
      },
    );
  });

  it('keeps the newer generation on disk when an older emit finishes later', async () => {
    const outputJsonPath = join(tmpDir, 'src/prisma/contract.json');
    const outputDtsPath = join(tmpDir, 'src/prisma/contract.d.ts');
    const firstEmit = createDeferred<EmitResult>();
    const secondEmit = createDeferred<EmitResult>();

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
      await second;

      firstEmit.resolve(createEmitResult('older'));
      await first;
    });

    expect(await readFile(outputJsonPath, 'utf-8')).toBe(JSON.stringify({ generation: 'newer' }));
    expect(await readFile(outputDtsPath, 'utf-8')).toBe("export type Generation = 'newer';\n");
  });

  it('preserves the previous artifacts when a new emit write fails', async () => {
    const outputJsonPath = join(tmpDir, 'src/prisma/contract.json');
    const outputDtsPath = join(tmpDir, 'src/prisma/contract.d.ts');
    const previousJson = JSON.stringify({ generation: 'previous' });
    const previousDts = "export type Generation = 'previous';\n";

    await mkdir(join(tmpDir, 'src/prisma'), { recursive: true });
    await writeFile(outputJsonPath, previousJson, 'utf-8');
    await writeFile(outputDtsPath, previousDts, 'utf-8');

    mockedEmit.mockResolvedValue(createEmitResult('next'));

    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    mockedWriteFile.mockImplementation(async (...args: Parameters<FsWriteFile>) => {
      const [path] = args;
      if (String(path).includes('contract.d.ts')) {
        throw new Error('simulated dts write failure');
      }
      return actualFs.writeFile(...args);
    });

    await withMockedConfig(createSuccessfulConfig(outputJsonPath), async () => {
      await expect(
        executeContractEmit({ configPath: join(tmpDir, 'prisma-next.config.ts') }),
      ).rejects.toThrow('simulated dts write failure');
    });

    expect(await readFile(outputJsonPath, 'utf-8')).toBe(previousJson);
    expect(await readFile(outputDtsPath, 'utf-8')).toBe(previousDts);
  });

  it('keeps the last good artifacts when a newer request fails after superseding an older emit', async () => {
    const outputJsonPath = join(tmpDir, 'src/prisma/contract.json');
    const outputDtsPath = join(tmpDir, 'src/prisma/contract.d.ts');
    const previousJson = JSON.stringify({ generation: 'previous' });
    const previousDts = "export type Generation = 'previous';\n";
    const firstEmit = createDeferred<EmitResult>();

    await mkdir(join(tmpDir, 'src/prisma'), { recursive: true });
    await writeFile(outputJsonPath, previousJson, 'utf-8');
    await writeFile(outputDtsPath, previousDts, 'utf-8');

    mockedEmit
      .mockImplementationOnce(() => firstEmit.promise)
      .mockResolvedValueOnce(createEmitResult('newer'));

    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
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

      firstEmit.resolve(createEmitResult('older'));
      await first;
    });

    expect(await readFile(outputJsonPath, 'utf-8')).toBe(previousJson);
    expect(await readFile(outputDtsPath, 'utf-8')).toBe(previousDts);
  });

  it('does not expose split artifacts during commit steps', async () => {
    const outputJsonPath = join(tmpDir, 'src/prisma/contract.json');
    const outputDtsPath = join(tmpDir, 'src/prisma/contract.d.ts');
    const previousJson = JSON.stringify({ generation: 'previous' });
    const previousDts = "export type Generation = 'previous';\n";
    const nextJson = JSON.stringify({ generation: 'next' });
    const nextDts = "export type Generation = 'next';\n";

    await mkdir(join(tmpDir, 'src/prisma'), { recursive: true });
    await writeFile(outputJsonPath, previousJson, 'utf-8');
    await writeFile(outputDtsPath, previousDts, 'utf-8');

    mockedEmit.mockResolvedValue({
      storageHash: 'storage-next',
      profileHash: 'profile-next',
      contractJson: nextJson,
      contractDts: nextDts,
    });

    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const snapshots: Array<{
      readonly json: string | undefined;
      readonly dts: string | undefined;
      readonly to: string;
    }> = [];

    mockedRename.mockImplementation(async (...args: Parameters<typeof rename>) => {
      const [, to] = args;
      await actualFs.rename(...args);

      let json: string | undefined;
      let dts: string | undefined;

      try {
        json = await actualFs.readFile(outputJsonPath, 'utf-8');
      } catch {
        json = undefined;
      }

      try {
        dts = await actualFs.readFile(outputDtsPath, 'utf-8');
      } catch {
        dts = undefined;
      }

      snapshots.push({ json, dts, to: String(to) });
    });

    await withMockedConfig(createSuccessfulConfig(outputJsonPath), async () => {
      await executeContractEmit({
        configPath: join(tmpDir, 'prisma-next.config.ts'),
        signal: new AbortController().signal,
      });
    });

    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      expect([
        { json: previousJson, dts: previousDts },
        { json: nextJson, dts: nextDts },
      ]).toContainEqual({
        json: snapshot.json,
        dts: snapshot.dts,
      });
    }
  });
});
