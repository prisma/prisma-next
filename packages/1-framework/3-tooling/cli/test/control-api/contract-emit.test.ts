import { describe, expect, it } from 'vitest';
import {
  ContractEmitCancelledError,
  executeContractEmit,
} from '../../src/control-api/operations/contract-emit';

describe('executeContractEmit', () => {
  it('throws when configPath does not exist', async () => {
    await expect(executeContractEmit({ configPath: '/nonexistent/config.ts' })).rejects.toThrow();
  });

  it('respects signal cancellation before starting', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeContractEmit({
        configPath: 'prisma-next.config.ts',
        signal: controller.signal,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ContractEmitCancelledError ||
        (error instanceof Error && error.name === 'AbortError'),
    );
  });
});
