import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractSourceContext } from '@prisma-next/config/config-types';
import { type Contract, contractModels } from '@prisma-next/contract/types';
import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { timeouts } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { emptyContract, typescriptContract, typescriptContractFromPath } from '../src/config-types';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const stubContext: ContractSourceContext = {
  composedExtensionPacks: [],
  scalarTypeDescriptors: new Map(),
  authoringContributions: { field: {}, type: {}, entityTypes: {} },
  codecLookup: {
    get: () => undefined,
    targetTypesFor: () => undefined,
    metaFor: () => undefined,
    renderOutputTypeFor: () => undefined,
  },
  controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
  resolvedInputs: [],
};

describe('typescriptContract', () => {
  it('returns provider result with contract', async () => {
    const contract = { targetFamily: 'sql', target: 'postgres' } as Contract;
    const config = typescriptContract(contract, 'output/contract.json');
    const result = await config.source.load(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toBe(contract);
    expect(config.output).toBe('output/contract.json');
    expect(config.source.inputs).toBeUndefined();
  });

  it('omits output when not provided', () => {
    const contract = { targetFamily: 'sql', target: 'postgres' } as Contract;
    const config = typescriptContract(contract);

    expect(config.output).toBeUndefined();
    expect(config.source.inputs).toBeUndefined();
  });

  it('derives output colocated with input path when output is not provided (TML-2461)', () => {
    const config = typescriptContractFromPath('./prisma/contract.ts');
    expect(config.output).toBe('./prisma/contract.json');
  });

  it('honours an explicit output over the derived default', () => {
    const config = typescriptContractFromPath('./prisma/contract.ts', 'custom/out.json');
    expect(config.output).toBe('custom/out.json');
  });

  it('derives output for an extensionless input path', () => {
    const config = typescriptContractFromPath('./prisma/contract');
    expect(config.output).toBe('./prisma/contract.json');
  });

  it(
    'loads a contract module from the resolved input path',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'sql-contract-ts-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(
          contractPath,
          `export default { targetFamily: 'sql', target: 'postgres' };\n`,
          'utf-8',
        );

        const config = typescriptContractFromPath('./contract.ts');
        const result = await config.source.load({
          ...stubContext,
          resolvedInputs: [contractPath],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toMatchObject({
          targetFamily: 'sql',
          target: 'postgres',
        });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'throws when the module exports neither default nor contract',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'sql-contract-ts-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(contractPath, 'export const notContract = {};\n', 'utf-8');

        const config = typescriptContractFromPath('./contract.ts');

        await expect(
          config.source.load({
            ...stubContext,
            resolvedInputs: [contractPath],
          }),
        ).rejects.toThrow(/has no "default" or "contract" export/);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    timeouts.typeScriptCompilation,
  );
});

describe('emptyContract', () => {
  it('loads an empty SQL contract for the target', async () => {
    const config = emptyContract({ target: postgresTargetPack });
    const result = await config.source.load(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const contract = result.value;
    expect(contractModels(contract)).toEqual({});
    expect(contract.targetFamily).toBe('sql');
    expect(contract.target).toBe('postgres');
    expect(contract.extensionPacks).toEqual({});
    expect(contract.capabilities).toEqual({});
    const publicNamespace = contract.storage.namespaces['public'] as unknown as Record<
      string,
      unknown
    >;
    expect(publicNamespace['tables']).toEqual({});
  });

  it('sets output when passed and omits it otherwise', () => {
    const withOutput = emptyContract({
      target: postgresTargetPack,
      output: 'src/contract.json',
    });
    expect(withOutput.output).toBe('src/contract.json');

    const withoutOutput = emptyContract({ target: postgresTargetPack });
    expect(withoutOutput.output).toBeUndefined();
  });
});
