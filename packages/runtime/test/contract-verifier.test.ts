import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyContract, assertContract, ContractVerifierOptions } from '../src/contract-verifier';

describe('Contract Verifier', () => {
  let mockClient: { query: ReturnType<typeof vi.fn> };
  let options: ContractVerifierOptions;

  beforeEach(() => {
    mockClient = {
      query: vi.fn(),
    };

    options = {
      expectedHash: 'sha256:98f2a1b2c3d4e5f6',
      client: mockClient,
    };
  });

  describe('verifyContract', () => {
    it('returns ok: true when hashes match', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{ hash: 'sha256:98f2a1b2c3d4e5f6' }],
      });

      const result = await verifyContract(options);

      expect(result).toEqual({
        ok: true,
        dbHash: 'sha256:98f2a1b2c3d4e5f6',
      });
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT hash FROM prisma_contract.version WHERE id = $1',
        [1],
      );
    });

    it('returns E_CONTRACT_MISMATCH when hashes differ', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{ hash: 'sha256:e1aa2b3c4d5e6f7' }],
      });

      const result = await verifyContract(options);

      expect(result).toEqual({
        ok: false,
        code: 'E_CONTRACT_MISMATCH',
        dbHash: 'sha256:e1aa2b3c4d5e6f7',
        expected: 'sha256:98f2a1b2c3d4e5f6',
      });
    });

    it('returns E_CONTRACT_MISSING when no row found', async () => {
      mockClient.query.mockResolvedValue({
        rows: [],
      });

      const result = await verifyContract(options);

      expect(result).toEqual({
        ok: false,
        code: 'E_CONTRACT_MISSING',
        expected: 'sha256:98f2a1b2c3d4e5f6',
      });
    });

    it('uses custom schema, table, and id parameters', async () => {
      const customOptions = {
        ...options,
        schema: 'custom_schema',
        table: 'custom_table',
        id: 42,
      };

      mockClient.query.mockResolvedValue({
        rows: [{ hash: 'sha256:98f2a1b2c3d4e5f6' }],
      });

      await verifyContract(customOptions);

      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT hash FROM custom_schema.custom_table WHERE id = $1',
        [42],
      );
    });

    it('retries on database errors', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // First two calls fail, third succeeds
      mockClient.query
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce({
          rows: [{ hash: 'sha256:98f2a1b2c3d4e5f6' }],
        });

      const result = await verifyContract({
        ...options,
        retries: 2,
        retryDelayMs: 10,
      });

      expect(result).toEqual({
        ok: true,
        dbHash: 'sha256:98f2a1b2c3d4e5f6',
      });
      expect(mockClient.query).toHaveBeenCalledTimes(3);

      consoleSpy.mockRestore();
    });

    it('throws error after exhausting retries', async () => {
      mockClient.query.mockRejectedValue(new Error('Connection timeout'));

      await expect(
        verifyContract({
          ...options,
          retries: 1,
          retryDelayMs: 10,
        }),
      ).rejects.toThrow('Connection timeout');

      expect(mockClient.query).toHaveBeenCalledTimes(2); // Initial + 1 retry
    });
  });

  describe('assertContract', () => {
    it('does not throw when hashes match', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{ hash: 'sha256:98f2a1b2c3d4e5f6' }],
      });

      await expect(assertContract(options)).resolves.toBeUndefined();
    });

    it('throws E_CONTRACT_MISMATCH error with actionable message', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{ hash: 'sha256:e1aa2b3c4d5e6f7' }],
      });

      await expect(assertContract(options)).rejects.toThrow(
        'E_CONTRACT_MISMATCH: Database contract hash differs from application.\n' +
          'app: sha256:98f2a1b2c3d4e5f6\n' +
          'db : sha256:e1aa2b3c4d5e6f7\n' +
          'fix: apply migrations for the current contract or deploy the matching build.',
      );
    });

    it('throws E_CONTRACT_MISSING error with remediation hint', async () => {
      mockClient.query.mockResolvedValue({
        rows: [],
      });

      await expect(assertContract(options)).rejects.toThrow(
        'E_CONTRACT_MISSING: No contract hash row found at prisma_contract.version(id=1).\n' +
          'expected: sha256:98f2a1b2c3d4e5f6\n' +
          'fix: apply migrations or seed prisma_contract.version with the expected hash.',
      );
    });

    it('uses custom schema/table/id in error messages', async () => {
      const customOptions = {
        ...options,
        schema: 'custom_schema',
        table: 'custom_table',
        id: 42,
      };

      mockClient.query.mockResolvedValue({
        rows: [],
      });

      await expect(assertContract(customOptions)).rejects.toThrow(
        'E_CONTRACT_MISSING: No contract hash row found at custom_schema.custom_table(id=42).\n' +
          'expected: sha256:98f2a1b2c3d4e5f6\n' +
          'fix: apply migrations or seed custom_schema.custom_table with the expected hash.',
      );
    });

    it('logs warning instead of throwing in warn mode', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockClient.query.mockResolvedValue({
        rows: [{ hash: 'sha256:e1aa2b3c4d5e6f7' }],
      });

      await assertContract({
        ...options,
        mode: 'warn',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'E_CONTRACT_MISMATCH: Database contract hash differs from application.\n' +
          'app: sha256:98f2a1b2c3d4e5f6\n' +
          'db : sha256:e1aa2b3c4d5e6f7\n' +
          'fix: apply migrations for the current contract or deploy the matching build.',
      );

      consoleSpy.mockRestore();
    });

    it('logs warning for missing contract in warn mode', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockClient.query.mockResolvedValue({
        rows: [],
      });

      await assertContract({
        ...options,
        mode: 'warn',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'E_CONTRACT_MISSING: No contract hash row found at prisma_contract.version(id=1).\n' +
          'expected: sha256:98f2a1b2c3d4e5f6\n' +
          'fix: apply migrations or seed prisma_contract.version with the expected hash.',
      );

      consoleSpy.mockRestore();
    });
  });
});
