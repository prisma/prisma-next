import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractSourceContext } from '@prisma-next/config/config-types';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { mongoContract } from '../src/exports/provider';

const originalCwd = process.cwd();
const tempDirs: string[] = [];

const mongoScalarTypeDescriptors: ReadonlyMap<string, string> = new Map([
  ['String', 'mongo/string@1'],
  ['ObjectId', 'mongo/objectId@1'],
]);

function createMongoTestContext(overrides?: Partial<ContractSourceContext>): ContractSourceContext {
  return {
    composedExtensionPacks: [],
    scalarTypeDescriptors: mongoScalarTypeDescriptors,
    authoringContributions: { field: {}, type: {} },
    codecLookup: emptyCodecLookup,
    controlMutationDefaults: {
      defaultFunctionRegistry: new Map(),
      generatorDescriptors: [],
    },
    resolvedInputs: [],
    ...overrides,
  };
}

describe('mongoContract provider helper', () => {
  afterEach(async () => {
    process.chdir(originalCwd);
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('exposes watch inputs from schema path', () => {
    const config = mongoContract('./schema.prisma', {
      output: 'output/contract.json',
    });

    expect(config.output).toBe('output/contract.json');
    expect(config.source.inputs).toEqual(['./schema.prisma']);
  });

  it('resolves relative schema paths from configDir when cwd differs', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'mongo-psl-provider-config-'));
    const cwdDir = await mkdtemp(join(tmpdir(), 'mongo-psl-provider-cwd-'));
    tempDirs.push(configDir, cwdDir);
    const schemaPath = join(configDir, 'schema.prisma');
    await writeFile(
      schemaPath,
      `model User {
  id ObjectId @id @map("_id")
  email String
}
`,
      'utf-8',
    );

    process.chdir(cwdDir);
    const contract = mongoContract('./schema.prisma');
    const result = await contract.source.load(
      createMongoTestContext({ resolvedInputs: [schemaPath] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({
      targetFamily: 'mongo',
      target: 'mongo',
      models: {
        User: expect.any(Object),
      },
    });
  });

  it('returns read failure diagnostics with the resolved absolute schema path', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'mongo-psl-provider-'));
    tempDirs.push(tempDir);
    const contract = mongoContract('./missing.prisma');
    const result = await contract.source.load(
      createMongoTestContext({ resolvedInputs: [join(tempDir, 'missing.prisma')] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure).toMatchObject({
      summary: 'Failed to read Prisma schema at "./missing.prisma"',
      diagnostics: [
        expect.objectContaining({
          code: 'PSL_SCHEMA_READ_FAILED',
          sourceId: './missing.prisma',
        }),
      ],
      meta: {
        schemaPath: './missing.prisma',
        absoluteSchemaPath: expect.stringMatching(/missing\.prisma$/),
        cause: expect.any(String),
      },
    });
  });
});
