import { createSqlOperationRegistry } from '@prisma-next/sql-operations';
import { createCodecRegistry, OperationExpr, ParamRef } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import pgvectorDescriptor from '../src/exports/runtime';

describe('pgvector operations', () => {
  it('descriptor has correct metadata', () => {
    expect(pgvectorDescriptor.kind).toBe('extension');
    expect(pgvectorDescriptor.id).toBe('pgvector');
    expect(pgvectorDescriptor.familyId).toBe('sql');
    expect(pgvectorDescriptor.targetId).toBe('postgres');
    expect(pgvectorDescriptor.version).toBe('0.0.1');
  });

  it('descriptor provides codec registry with vector codec', () => {
    const codecs = pgvectorDescriptor.codecs();
    expect(codecs).toBeDefined();

    const vectorCodec = codecs.get('pg/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('pg/vector@1');
  });

  it('descriptor provides query operations whose impls build AST with lowering', () => {
    const operations = pgvectorDescriptor.queryOperations!();
    expect(operations).toBeDefined();
    expect(operations.length).toBe(2);

    const cosineDistanceOp = operations.find((op) => op.method === 'cosineDistance');
    expect(cosineDistanceOp).toBeDefined();
    const distExpr = cosineDistanceOp?.impl(
      ParamRef.of([1, 2], { codecId: 'pg/vector@1' }) as never,
      [3, 4] as never,
    ) as unknown as { buildAst(): OperationExpr };
    const distAst = distExpr.buildAst();
    expect(distAst).toBeInstanceOf(OperationExpr);
    expect(distAst.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'function',
      template: '{{self}} <=> {{arg0}}',
    });

    const cosineSimilarityOp = operations.find((op) => op.method === 'cosineSimilarity');
    expect(cosineSimilarityOp).toBeDefined();
    const simExpr = cosineSimilarityOp?.impl(
      ParamRef.of([1, 2], { codecId: 'pg/vector@1' }) as never,
      [3, 4] as never,
    ) as unknown as { buildAst(): OperationExpr };
    const simAst = simExpr.buildAst();
    expect(simAst).toBeInstanceOf(OperationExpr);
    expect(simAst.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'function',
      template: '1 - ({{self}} <=> {{arg0}})',
    });
  });

  it('operations can be registered in registry', () => {
    const operations = pgvectorDescriptor.queryOperations!();

    const registry = createSqlOperationRegistry();
    for (const op of operations) {
      registry.register(op);
    }

    const entries = registry.entries();
    expect(entries['cosineDistance']).toBeDefined();
    expect(entries['cosineSimilarity']).toBeDefined();
  });

  it('codecs can be registered in codec registry', () => {
    const descriptorCodecs = pgvectorDescriptor.codecs();
    expect(descriptorCodecs).toBeDefined();

    const registry = createCodecRegistry();
    for (const codec of descriptorCodecs.values()) {
      registry.register(codec);
    }

    const vectorCodec = registry.get('pg/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('pg/vector@1');
  });

  it('instance is minimal (identity only)', () => {
    const instance = pgvectorDescriptor.create();
    expect(instance.familyId).toBe('sql');
    expect(instance.targetId).toBe('postgres');
  });
});
