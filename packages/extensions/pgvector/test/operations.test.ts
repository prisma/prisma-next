import { createOperationRegistry } from '@prisma-next/operations';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import pgvector from '../src/exports/runtime';

describe('pgvector operations', () => {
  it('provides codec registry with vector codec', () => {
    const extension = pgvector();
    const codecs = extension.codecs?.();
    expect(codecs).toBeDefined();

    const vectorCodec = codecs?.get('pg/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('pg/vector@1');
  });

  it('provides operation signatures', () => {
    const extension = pgvector();
    const operations = extension.operations?.();
    expect(operations).toBeDefined();
    expect(operations?.length).toBe(1);

    const cosineDistanceOp = operations?.[0];
    expect(cosineDistanceOp).toBeDefined();
    expect(cosineDistanceOp?.forTypeId).toBe('pg/vector@1');
    expect(cosineDistanceOp?.method).toBe('cosineDistance');
    expect(cosineDistanceOp?.args).toEqual([{ kind: 'param' }]);
    expect(cosineDistanceOp?.returns).toEqual({ kind: 'builtin', type: 'number' });
    expect(cosineDistanceOp?.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'function',
      template: '1 - ({{self}} <=> {{arg0}})',
    });
  });

  it('operations can be registered in operation registry', () => {
    const extension = pgvector();
    const operations = extension.operations?.();
    expect(operations).toBeDefined();

    const registry = createOperationRegistry();
    for (const op of operations ?? []) {
      registry.register(op);
    }

    const registeredOps = registry.byType('pg/vector@1');
    expect(registeredOps.length).toBe(1);
    expect(registeredOps[0]?.method).toBe('cosineDistance');
  });

  it('codecs can be registered in codec registry', () => {
    const extension = pgvector();
    const codecs = extension.codecs?.();
    expect(codecs).toBeDefined();

    const registry = createCodecRegistry();
    for (const codec of codecs?.values() ?? []) {
      registry.register(codec);
    }

    const vectorCodec = registry.get('pg/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('pg/vector@1');
  });
});
