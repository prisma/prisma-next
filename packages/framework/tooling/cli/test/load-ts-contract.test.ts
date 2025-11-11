import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { loadContractFromTs } from '../src/load-ts-contract';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('loadContractFromTs', () => {
  it(
    'loads a valid contract with named export',
    async () => {
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      const contract = await loadContractFromTs(contractPath);

      expect(contract).toBeDefined();
      expect(contract.targetFamily).toBe('sql');
      expect(contract.target).toBe('postgres');
      expect(contract.storage).toBeDefined();
      expect(contract.models).toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'loads a valid contract with default export',
    async () => {
      const contractPath = join(fixturesDir, 'valid-contract-default.ts');
      const contract = await loadContractFromTs(contractPath);

      expect(contract).toBeDefined();
      expect(contract.targetFamily).toBe('sql');
      expect(contract.target).toBe('postgres');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'rejects disallowed imports',
    async () => {
      const contractPath = join(fixturesDir, 'disallowed-import.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow('Disallowed imports detected');
    },
    timeouts.typeScriptCompilation,
  );

  it('rejects missing contract export', async () => {
    const contractPath = join(fixturesDir, 'invalid-export.ts');

    await expect(loadContractFromTs(contractPath)).rejects.toThrow(
      'Contract file must export a contract',
    );
  });

  it('rejects module with other exports but no contract', async () => {
    const contractPath = join(fixturesDir, 'other-exports.ts');

    await expect(loadContractFromTs(contractPath)).rejects.toThrow(
      'Contract file must export a contract',
    );
  });

  it('rejects empty module with no exports', async () => {
    const contractPath = join(fixturesDir, 'empty-module.ts');

    await expect(loadContractFromTs(contractPath)).rejects.toThrow(
      'Contract file must export a contract',
    );
  });

  it('rejects non-object contract export', async () => {
    const contractPath = join(fixturesDir, 'function-export.ts');

    await expect(loadContractFromTs(contractPath)).rejects.toThrow(
      'Contract export must be an object',
    );
  });

  it(
    'rejects non-serializable contract export',
    async () => {
      const contractPath = join(fixturesDir, 'non-serializable.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow(
        'Contract export contains getter/setter',
      );
    },
    timeouts.typeScriptCompilation,
  );

  it('handles bundling errors', async () => {
    const invalidPath = join(fixturesDir, 'nonexistent-file.ts');

    await expect(loadContractFromTs(invalidPath)).rejects.toThrow();
  });

  it(
    'rejects functions in contract export',
    async () => {
      const contractPath = join(fixturesDir, 'function-in-object.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow(
        'Contract export contains function',
      );
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'rejects circular references in contract',
    async () => {
      const contractPath = join(fixturesDir, 'json-serialize-error.ts');

      await expect(loadContractFromTs(contractPath)).rejects.toThrow(
        'Contract export contains circular references',
      );
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'uses custom allowlist when provided',
    async () => {
      const contractPath = join(fixturesDir, 'custom-allowlist.ts');

      const contract = await loadContractFromTs(contractPath, {
        allowlist: ['@custom/package/*', '@prisma-next/*'],
      });

      expect(contract).toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );

  it('rejects imports not in custom allowlist', async () => {
    const contractPath = join(fixturesDir, 'disallowed-import.ts');

    await expect(
      loadContractFromTs(contractPath, {
        allowlist: ['@other/package/*'],
      }),
    ).rejects.toThrow('Disallowed imports detected');
  });

  it(
    'handles allowlist pattern matching exact prefix',
    async () => {
      const contractPath = join(fixturesDir, 'exact-prefix-import.ts');

      const contract = await loadContractFromTs(contractPath, {
        allowlist: ['@prisma-next/*'],
      });

      expect(contract).toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );
});
