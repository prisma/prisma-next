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

  it('returns the same diagnostics as load when parse and symbol table are clean', async () => {
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
    const interpretDiagnostics = source.interpret(buildInterpretInput(schema, context), context);

    expect(interpretDiagnostics).toEqual(loadResult.failure.diagnostics);
    expect(interpretDiagnostics).toEqual(
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

  it('returns [] for a schema load interprets successfully', async () => {
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

    const context = createPostgresTestContext();
    const interpretDiagnostics = source.interpret(buildInterpretInput(schema, context), context);

    expect(interpretDiagnostics).toEqual([]);
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

    let diagnostics: readonly unknown[] = [];
    expect(() => {
      diagnostics = source.interpret(input, context);
    }).not.toThrow();

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_UNSUPPORTED_FIELD_TYPE', sourceId: SOURCE_ID }),
      ]),
    );
  });

  it('excludes parse and symbol-table seeds from interpret diagnostics', async () => {
    // The same schema through load carries symbol-table seeds; interpret starts
    // from the caller's artifacts, so only interpreter-produced diagnostics appear.
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
    const interpretDiagnostics = source.interpret(buildInterpretInput(schema, context), context);

    const loadCodes = loadResult.failure.diagnostics.map((d) => d.code);
    const interpretCodes = interpretDiagnostics.map((d) => d.code);
    expect(loadCodes).toContain('PSL_DUPLICATE_DECLARATION');
    expect(interpretCodes).toContain('PSL_UNSUPPORTED_FIELD_TYPE');
    expect(interpretCodes).not.toContain('PSL_DUPLICATE_DECLARATION');
    expect(loadCodes).toEqual(expect.arrayContaining(interpretCodes));
    expect(loadCodes.length).toBeGreaterThan(interpretCodes.length);
  });
});
