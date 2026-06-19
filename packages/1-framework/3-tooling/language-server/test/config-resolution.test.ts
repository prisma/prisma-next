import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as configLoader from '@prisma-next/config-loader';
import { errorConfigValidation, errorUnexpected } from '@prisma-next/errors/control';
import { timeouts } from '@prisma-next/test-utils';
import { ok } from '@prisma-next/utils/result';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfigInputs, resolveConfigInputsForFile } from '../src/config-resolution';

vi.mock('@prisma-next/config-loader', { spy: true });

type LoadedConfig = Awaited<ReturnType<typeof configLoader.loadConfig>>;

function loadedConfigWithInput(input: string): LoadedConfig {
  return {
    family: {
      kind: 'family',
      version: '1',
      id: 'sql',
      familyId: 'sql',
      emission: {
        id: 'sql',
        generateStorageType: () => '{}',
        generateModelStorageType: () => '{}',
        getFamilyImports: () => [],
        getFamilyTypeAliases: () => '',
        getTypeMapsExpression: () => 'never',
        getContractWrapper: (base) => base,
      },
      create: () => ({ familyId: 'sql' }) as never,
    },
    target: {
      kind: 'target',
      version: '1',
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      contractSerializer: {
        deserializeContract: (json) => json as never,
        serializeContract: () => ({}),
      },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    adapter: {
      kind: 'adapter',
      version: '1',
      id: 'postgres',
      familyId: 'sql',
      targetId: 'postgres',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    contract: {
      source: {
        inputs: [input],
        load: async () => ok({ target: 'postgres' } as never),
      },
      output: join(dirname(input), 'contract.json'),
    },
  };
}

describe('resolveConfigInputs', { timeout: timeouts.coldTransformImport }, () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('degrades to an empty input set with a reason when no config exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-noconfig-'));
    const resolution = await resolveConfigInputs(root);
    expect(resolution.inputs.includes(pathToFileURL(join(root, 'schema.psl')).toString())).toBe(
      false,
    );
    expect(resolution.degradedReason).toMatch(/no prisma next config/i);
  });

  it('degrades to an empty input set with a reason when the config is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-badconfig-'));
    await writeFile(join(root, 'prisma-next.config.ts'), 'export default { family: {} };\n');
    const resolution = await resolveConfigInputs(root);
    expect(resolution.inputs.includes(pathToFileURL(join(root, 'schema.psl')).toString())).toBe(
      false,
    );
    expect(resolution.degradedReason).toMatch(/invalid/i);
  });

  it('re-throws unexpected structured errors instead of degrading', async () => {
    vi.spyOn(configLoader, 'loadConfig').mockRejectedValue(
      errorUnexpected('boom', { why: 'Failed to load config: boom' }),
    );
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-unexpected-'));

    await expect(resolveConfigInputs(root)).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: '4999',
    });
  });
});

describe('resolveConfigInputsForFile', { timeout: timeouts.coldTransformImport }, () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('loads the nearest config above the PSL file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-nearest-'));
    const nestedDir = join(root, 'apps', 'shop', 'prisma');
    const schemaPath = join(nestedDir, 'schema.psl');
    const rootConfigPath = join(root, 'prisma-next.config.ts');
    const nestedConfigPath = join(root, 'apps', 'shop', 'prisma-next.config.ts');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(rootConfigPath, 'export default {}');
    await writeFile(nestedConfigPath, 'export default {}');
    const loadConfig = vi
      .spyOn(configLoader, 'loadConfig')
      .mockResolvedValue(loadedConfigWithInput(schemaPath));

    const resolution = await resolveConfigInputsForFile(root, schemaPath);

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(loadConfig).toHaveBeenCalledWith(nestedConfigPath);
    expect(resolution.inputs.includes(pathToFileURL(schemaPath).toString())).toBe(true);
  });

  it('stops at an invalid nearest config instead of falling back to a parent config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-nearest-invalid-'));
    const nestedDir = join(root, 'apps', 'shop', 'prisma');
    const schemaPath = join(nestedDir, 'schema.psl');
    const rootConfigPath = join(root, 'prisma-next.config.ts');
    const nestedConfigPath = join(root, 'apps', 'shop', 'prisma-next.config.ts');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(rootConfigPath, 'export default {}');
    await writeFile(nestedConfigPath, 'export default {}');
    const loadConfig = vi
      .spyOn(configLoader, 'loadConfig')
      .mockRejectedValue(errorConfigValidation('family'));

    const resolution = await resolveConfigInputsForFile(root, schemaPath);

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(loadConfig).toHaveBeenCalledWith(nestedConfigPath);
    expect(resolution.inputs.includes(pathToFileURL(schemaPath).toString())).toBe(false);
    expect(resolution.degradedReason).toMatch(/invalid/i);
  });
});
