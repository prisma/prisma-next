import { describe, expect, it, vi } from 'vitest';
import * as configLoader from '../../src/config-loader';
import { executeContractEmit } from '../../src/control-api/operations/contract-emit';

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
      {
        contract: {
          source: async () => {
            throw new DOMException('Aborted by test', 'AbortError');
          },
          output: './src/prisma/contract.json',
        },
      } as unknown as Awaited<ReturnType<typeof configLoader.loadConfig>>,
      async () => {
        await expect(
          executeContractEmit({ configPath: 'prisma-next.config.ts' }),
        ).rejects.toSatisfy(
          (error: unknown) => error instanceof Error && error.name === 'AbortError',
        );
      },
    );
  });

  it('throws when contract source is not callable', async () => {
    await withMockedConfig(
      {
        contract: {
          source: { invalid: true },
          output: './src/prisma/contract.json',
        },
      } as unknown as Awaited<ReturnType<typeof configLoader.loadConfig>>,
      async () => {
        await expect(
          executeContractEmit({ configPath: 'prisma-next.config.ts' }),
        ).rejects.toSatisfy(
          (error: unknown) =>
            error instanceof Error &&
            'why' in error &&
            typeof error.why === 'string' &&
            error.why.includes('valid source provider function'),
        );
      },
    );
  });

  it('throws runtime error when contract source provider returns failure result', async () => {
    await withMockedConfig(
      {
        contract: {
          source: async () => ({
            ok: false,
            failure: {
              summary: 'Provider parse failed',
              diagnostics: [{ code: 'PSL_PARSE_ERROR', message: 'Unexpected token' }],
              meta: { sourceId: 'schema.prisma' },
            },
          }),
          output: './src/prisma/contract.json',
        },
      } as unknown as Awaited<ReturnType<typeof configLoader.loadConfig>>,
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
      {
        contract: {
          source: async () =>
            ({
              ok: false,
            }) as unknown,
          output: './src/prisma/contract.json',
        },
      } as unknown as Awaited<ReturnType<typeof configLoader.loadConfig>>,
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
      {
        contract: {
          source: async () =>
            ({
              ok: true,
            }) as unknown,
          output: './src/prisma/contract.json',
        },
      } as unknown as Awaited<ReturnType<typeof configLoader.loadConfig>>,
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
