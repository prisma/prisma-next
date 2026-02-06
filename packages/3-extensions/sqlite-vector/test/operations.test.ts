import { createOperationRegistry } from '@prisma-next/operations';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import sqliteVectorDescriptor from '../src/exports/runtime';

describe('sqlite-vector operations', () => {
  it('descriptor has correct metadata', () => {
    expect(sqliteVectorDescriptor.kind).toBe('extension');
    expect(sqliteVectorDescriptor.id).toBe('sqlitevector');
    expect(sqliteVectorDescriptor.familyId).toBe('sql');
    expect(sqliteVectorDescriptor.targetId).toBe('sqlite');
    expect(sqliteVectorDescriptor.version).toBe('0.0.1');
  });

  it('provides codec registry with vector codec', () => {
    const extension = sqliteVectorDescriptor.create();
    const codecs = extension.codecs?.();
    expect(codecs).toBeDefined();

    const vectorCodec = codecs?.get('sqlite/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('sqlite/vector@1');
  });

  it('provides operation signatures', () => {
    const extension = sqliteVectorDescriptor.create();
    const operations = extension.operations?.();
    expect(operations).toBeDefined();
    expect(operations?.length).toBe(1);

    const cosineDistanceOp = operations?.[0];
    expect(cosineDistanceOp).toBeDefined();
    expect(cosineDistanceOp?.forTypeId).toBe('sqlite/vector@1');
    expect(cosineDistanceOp?.method).toBe('cosineDistance');
    expect(cosineDistanceOp?.args).toEqual([{ kind: 'param' }]);
    expect(cosineDistanceOp?.returns).toEqual({ kind: 'builtin', type: 'number' });
    expect(cosineDistanceOp?.lowering.targetFamily).toBe('sql');
    expect(cosineDistanceOp?.lowering.strategy).toBe('function');
    expect(cosineDistanceOp?.lowering.template).toContain('json_each');
    expect(cosineDistanceOp?.lowering.template).toContain('SQRT');
  });

  it('operations can be registered in operation registry', () => {
    const extension = sqliteVectorDescriptor.create();
    const operations = extension.operations?.();
    expect(operations).toBeDefined();

    const registry = createOperationRegistry();
    for (const op of operations ?? []) {
      registry.register(op);
    }

    const registeredOps = registry.byType('sqlite/vector@1');
    expect(registeredOps.length).toBe(1);
    expect(registeredOps[0]?.method).toBe('cosineDistance');
  });

  it('codecs can be registered in codec registry', () => {
    const extension = sqliteVectorDescriptor.create();
    const codecs = extension.codecs?.();
    expect(codecs).toBeDefined();

    const registry = createCodecRegistry();
    for (const codec of codecs?.values() ?? []) {
      registry.register(codec);
    }

    const vectorCodec = registry.get('sqlite/vector@1');
    expect(vectorCodec).toBeDefined();
    expect(vectorCodec?.id).toBe('sqlite/vector@1');
  });
});
