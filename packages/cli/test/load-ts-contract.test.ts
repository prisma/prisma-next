import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContractFromTs } from '../src/load-ts-contract';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('loadContractFromTs', () => {
  it('loads a valid contract with named export', async () => {
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const contract = await loadContractFromTs(contractPath);

    expect(contract).toBeDefined();
    expect(contract.targetFamily).toBe('sql');
    expect(contract.target).toBe('postgres');
    expect(contract.storage).toBeDefined();
    expect(contract.models).toBeDefined();
  });

  it('loads a valid contract with default export', async () => {
    const contractPath = join(fixturesDir, 'valid-contract-default.ts');
    const contract = await loadContractFromTs(contractPath);

    expect(contract).toBeDefined();
    expect(contract.targetFamily).toBe('sql');
    expect(contract.target).toBe('postgres');
  });

  it('rejects disallowed imports', async () => {
    const contractPath = join(fixturesDir, 'disallowed-import.ts');

    await expect(loadContractFromTs(contractPath)).rejects.toThrow('Disallowed imports detected');
  });

  it('rejects missing contract export', async () => {
    const contractPath = join(fixturesDir, 'invalid-export.ts');

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

  it('rejects non-serializable contract export', async () => {
    const contractPath = join(fixturesDir, 'non-serializable.ts');

    await expect(loadContractFromTs(contractPath)).rejects.toThrow(
      'Contract export contains getter/setter',
    );
  });
});
