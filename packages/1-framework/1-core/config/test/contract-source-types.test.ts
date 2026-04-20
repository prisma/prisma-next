import { resolve } from 'node:path';
import type { ContractSourceContext } from '@prisma-next/config/config-types';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { ok } from '@prisma-next/utils/result';
import { describe, expect, it } from 'vitest';
import { createPathBackedSource } from '../src/contract-source-types';

const stubContext: ContractSourceContext = {
  composedExtensionPacks: [],
  scalarTypeDescriptors: new Map(),
  authoringContributions: { field: {}, type: {} },
  codecLookup: emptyCodecLookup,
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [],
  },
};

describe('createPathBackedSource', () => {
  it('declares the provided input path and resolves it from configDir when loading', async () => {
    const source = createPathBackedSource(
      './schema.prisma',
      async ({ inputPath, absoluteInputPath }, context, environment) => {
        expect(inputPath).toBe('./schema.prisma');
        expect(absoluteInputPath).toBe(resolve('/tmp/project', './schema.prisma'));
        expect(context).toBe(stubContext);
        expect(environment).toEqual({ configDir: '/tmp/project' });
        return ok({ targetFamily: 'sql', target: 'postgres' } as never);
      },
    );

    expect(source.inputs).toEqual(['./schema.prisma']);

    const result = await source.load(stubContext, { configDir: '/tmp/project' });

    expect(result.ok).toBe(true);
  });

  it('preserves absolute input paths', async () => {
    const absolutePath = resolve('/tmp/project', 'schema.prisma');
    const source = createPathBackedSource(
      absolutePath,
      async ({ inputPath, absoluteInputPath }) => {
        expect(inputPath).toBe(absolutePath);
        expect(absoluteInputPath).toBe(absolutePath);
        return ok({ targetFamily: 'sql', target: 'postgres' } as never);
      },
    );

    expect(source.inputs).toEqual([absolutePath]);

    const result = await source.load(stubContext, { configDir: '/tmp/other-project' });

    expect(result.ok).toBe(true);
  });
});
