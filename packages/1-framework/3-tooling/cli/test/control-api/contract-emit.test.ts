import { describe, expect, it, vi } from 'vitest';
import * as configLoader from '../../src/config-loader';
import { executeContractEmit } from '../../src/control-api/operations/contract-emit';

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

describe('executeContractEmit', () => {
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
});
