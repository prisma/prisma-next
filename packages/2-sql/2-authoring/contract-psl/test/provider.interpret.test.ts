import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractSourceContext } from '@prisma-next/config/config-types';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { hasPslInterpreter, type PslInterpretInput } from '@prisma-next/psl-parser/interpret';
import { parse } from '@prisma-next/psl-parser/syntax';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { prismaContract } from '../src/exports/provider';
import { createPostgresTestContext, postgresTarget } from './fixtures';

const baseOptions = {
  target: postgresTarget,
  createNamespace: createTestSqlNamespace,
} as const;

const SOURCE_ID = './schema.prisma';

function buildInterpretInput(schema: string, context: ContractSourceContext): PslInterpretInput {
  const { document, sourceFile } = parse(schema);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes: [...context.scalarTypeDescriptors.keys()],
    pslBlockDescriptors: context.authoringContributions.pslBlockDescriptors,
  });
  return { document, sourceFile, symbolTable, sourceId: SOURCE_ID };
}

function interpretCapableSource(schemaPath: string) {
  const contract = prismaContract(schemaPath, baseOptions);
  if (!hasPslInterpreter(contract.source)) {
    throw new Error('expected prismaContract source to carry the interpret capability');
  }
  return contract.source;
}

describe('prismaContract interpret capability', () => {
  const originalCwd = process.cwd();
  const tempDirs: string[] = [];

  afterEach(async () => {
    process.chdir(originalCwd);
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('narrows a real prismaContract source via hasPslInterpreter', () => {
    const contract = prismaContract(SOURCE_ID, baseOptions);

    expect(hasPslInterpreter(contract.source)).toBe(true);
    if (!hasPslInterpreter(contract.source)) return;
    expect(typeof contract.source.interpret).toBe('function');
  });

  it('returns the same failure diagnostics as load when parse and symbol table are clean', async () => {
    const schema = `model User {
  id Int @id
  things Unknown[]
}
`;
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-interpret-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(schemaPath, schema, 'utf-8');

    process.chdir(tempDir);
    const source = interpretCapableSource(SOURCE_ID);
    const loadResult = await source.load(
      createPostgresTestContext({ resolvedInputs: [schemaPath] }),
    );
    expect(loadResult.ok).toBe(false);
    if (loadResult.ok) return;

    const context = createPostgresTestContext();
    const interpretResult = source.interpret(buildInterpretInput(schema, context), context);

    expect(interpretResult.ok).toBe(false);
    if (interpretResult.ok) return;
    expect(interpretResult.failure.diagnostics).toEqual(loadResult.failure.diagnostics);
    expect(interpretResult.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          sourceId: SOURCE_ID,
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 3 }),
          }),
        }),
      ]),
    );
  });

  it('returns the same contract load returns for a clean schema', async () => {
    const schema = `model User {
  id Int @id
  email String
}
`;
    const tempDir = await mkdtemp(join(tmpdir(), 'psl-interpret-'));
    tempDirs.push(tempDir);
    const schemaPath = join(tempDir, 'schema.prisma');
    await writeFile(schemaPath, schema, 'utf-8');

    process.chdir(tempDir);
    const source = interpretCapableSource(SOURCE_ID);
    const loadResult = await source.load(
      createPostgresTestContext({ resolvedInputs: [schemaPath] }),
    );
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) return;

    const context = createPostgresTestContext();
    const interpretResult = source.interpret(buildInterpretInput(schema, context), context);

    expect(interpretResult.ok).toBe(true);
    if (!interpretResult.ok) return;
    // baseOptions carries no defaultControlPolicy, so load's policy application
    // is an identity pass: interpret's pre-policy contract must be structurally
    // identical to the contract load returns.
    expect(interpretResult.value).toEqual(loadResult.value);
  });

  it('does not throw on malformed-but-parseable input and still reports interpreter diagnostics', () => {
    const schema = `model Dup {
  id Int @id
}
model Dup {
  id Int @id
}
model Other {
  id Int @id
  bad Mystery
}
`;
    const source = interpretCapableSource(SOURCE_ID);
    const context = createPostgresTestContext();
    const input = buildInterpretInput(schema, context);

    let result: ReturnType<typeof source.interpret> | undefined;
    expect(() => {
      result = source.interpret(input, context);
    }).not.toThrow();

    expect(result).toBeDefined();
    if (result === undefined || result.ok) {
      throw new Error('expected interpret to report diagnostics');
    }
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_UNSUPPORTED_FIELD_TYPE', sourceId: SOURCE_ID }),
      ]),
    );
  });

  it('does not throw on a recovered CST from a syntax-broken schema', () => {
    const schema = `model User {
  id Int @id
`;
    const source = interpretCapableSource(SOURCE_ID);
    const context = createPostgresTestContext();
    const input = buildInterpretInput(schema, context);

    let result: ReturnType<typeof source.interpret> | undefined;
    expect(() => {
      result = source.interpret(input, context);
    }).not.toThrow();

    expect(result).toBeDefined();
    expect(typeof result?.ok).toBe('boolean');
  });

  it('prepends caller seeds and excludes them when absent', () => {
    const schema = `model Other {
  id Int @id
  bad Mystery
}
`;
    const seed = {
      code: 'PSL_CALLER_SEED',
      message: 'seeded by the caller',
      sourceId: SOURCE_ID,
    };
    const source = interpretCapableSource(SOURCE_ID);
    const context = createPostgresTestContext();
    const input = buildInterpretInput(schema, context);

    const unseeded = source.interpret(input, context);
    const seeded = source.interpret(input, context, [seed]);

    expect(unseeded.ok).toBe(false);
    expect(seeded.ok).toBe(false);
    if (unseeded.ok || seeded.ok) return;

    expect(unseeded.failure.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_CALLER_SEED' })]),
    );
    expect(seeded.failure.diagnostics).toEqual([seed, ...unseeded.failure.diagnostics]);
  });
});
