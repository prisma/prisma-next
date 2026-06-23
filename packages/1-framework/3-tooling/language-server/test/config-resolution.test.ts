import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PrismaNextConfig } from '@prisma-next/config-loader';
import * as configLoader from '@prisma-next/config-loader';
import { errorUnexpected } from '@prisma-next/errors/control';
import type { AuthoringPslBlockDescriptorNamespace } from '@prisma-next/framework-components/authoring';
import type { ControlStack } from '@prisma-next/framework-components/control';
import * as control from '@prisma-next/framework-components/control';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfigInputs, resolveControlStackInputs } from '../src/config-resolution';

vi.mock('@prisma-next/config-loader', { spy: true });
vi.mock('@prisma-next/framework-components/control', { spy: true });

function loadedConfig(sourceFormat: string, inputs: readonly string[]): PrismaNextConfig {
  return { contract: { source: { sourceFormat, inputs } } } as unknown as PrismaNextConfig;
}

function stubStack(
  scalarTypeDescriptors: ReadonlyMap<string, string>,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
): ControlStack {
  return {
    scalarTypeDescriptors,
    authoringContributions: { pslBlockDescriptors },
  } as unknown as ControlStack;
}

describe('resolveConfigInputs', { timeout: timeouts.coldTransformImport }, () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('rejects when no config exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-noconfig-'));
    const configPath = join(root, 'prisma-next.config.ts');

    await expect(resolveConfigInputs(configPath)).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: '4001',
    });
  });

  it('rejects when the config is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-badconfig-'));
    const configPath = join(root, 'prisma-next.config.ts');
    await writeFile(configPath, 'export default { family: {} };\n');

    await expect(resolveConfigInputs(configPath)).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: '4009',
    });
  });

  it('re-throws unexpected structured errors', async () => {
    vi.spyOn(configLoader, 'loadConfig').mockRejectedValue(
      errorUnexpected('boom', { why: 'Failed to load config: boom' }),
    );
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-unexpected-'));
    const configPath = join(root, 'prisma-next.config.ts');

    await expect(resolveConfigInputs(configPath)).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: '4999',
    });
  });

  it('surfaces the control-stack-derived inputs for a psl config', async () => {
    vi.spyOn(configLoader, 'loadConfig').mockResolvedValue(
      loadedConfig('psl', ['/abs/schema.psl']),
    );
    vi.spyOn(control, 'createControlStack').mockReturnValue(
      stubStack(new Map([['Int', 'int']]), {}),
    );

    const result = await resolveConfigInputs('/abs/prisma-next.config.ts');

    expect(result.controlStack).toEqual({ scalarTypes: ['Int'], pslBlockDescriptors: {} });
    expect(result.inputs.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(true);
  });
});

describe('resolveControlStackInputs', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('returns undefined and never builds a stack for a non-psl source', () => {
    const createControlStack = vi.spyOn(control, 'createControlStack');

    const result = resolveControlStackInputs(loadedConfig('typescript', ['/abs/schema.psl']));

    expect(result).toBeUndefined();
    expect(createControlStack).not.toHaveBeenCalled();
  });

  it('returns control-stack-derived scalarTypes and pslBlockDescriptors for a psl source', () => {
    const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
      enum: {
        kind: 'pslBlock',
        keyword: 'enum',
        discriminator: 'enum',
        name: { required: true },
        parameters: {},
        variadicParameters: true,
      },
    };
    vi.spyOn(control, 'createControlStack').mockReturnValue(
      stubStack(
        new Map([
          ['Int', 'int'],
          ['String', 'string'],
        ]),
        pslBlockDescriptors,
      ),
    );

    const result = resolveControlStackInputs(loadedConfig('psl', ['/abs/schema.psl']));

    expect(result).toEqual({ scalarTypes: ['Int', 'String'], pslBlockDescriptors });
  });

  it('propagates createControlStack failures for a psl source', () => {
    vi.spyOn(control, 'createControlStack').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => resolveControlStackInputs(loadedConfig('psl', ['/abs/schema.psl']))).toThrow(
      'boom',
    );
  });
});
