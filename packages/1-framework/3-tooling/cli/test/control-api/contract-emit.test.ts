import { describe, expect, it, vi } from 'vitest';
import * as configLoader from '../../src/config-loader';
import { executeContractEmit } from '../../src/control-api/operations/contract-emit';

describe('executeContractEmit', () => {
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

  it('throws when contract source is not callable', async () => {
    const loadConfigSpy = vi.spyOn(configLoader, 'loadConfig').mockResolvedValue({
      contract: {
        source: { invalid: true },
        output: './src/prisma/contract.json',
      },
    } as unknown as Awaited<ReturnType<typeof configLoader.loadConfig>>);

    await expect(executeContractEmit({ configPath: 'prisma-next.config.ts' })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        'why' in error &&
        typeof error.why === 'string' &&
        error.why.includes('valid source provider function'),
    );

    loadConfigSpy.mockRestore();
  });
});
