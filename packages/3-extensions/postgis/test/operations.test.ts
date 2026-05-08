import { createSqlOperationRegistry } from '@prisma-next/sql-operations';
import { createCodecRegistry, OperationExpr, ParamRef } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import postgisDescriptor from '../src/exports/runtime';

describe('postgis operations', () => {
  it('descriptor has correct metadata', () => {
    expect(postgisDescriptor.kind).toBe('extension');
    expect(postgisDescriptor.id).toBe('postgis');
    expect(postgisDescriptor.familyId).toBe('sql');
    expect(postgisDescriptor.targetId).toBe('postgres');
    expect(postgisDescriptor.version).toBe('0.0.1');
  });

  it('descriptor provides codec registry with geometry codec', () => {
    const codecs = postgisDescriptor.codecs();
    expect(codecs).toBeDefined();
    const geometryCodec = codecs.get('pg/geometry@1');
    expect(geometryCodec).toBeDefined();
    expect(geometryCodec?.id).toBe('pg/geometry@1');
  });

  it('exposes the seven geospatial operations', () => {
    const operations = postgisDescriptor.queryOperations!();
    const methodNames = operations.map((op) => op.method).sort();
    expect(methodNames).toEqual(
      [
        'contains',
        'distance',
        'distanceSphere',
        'dwithin',
        'intersects',
        'intersectsBbox',
        'within',
      ].sort(),
    );
  });

  it('binary operation impls build AST with the right lowering template', () => {
    const operations = postgisDescriptor.queryOperations!();

    const cases: ReadonlyArray<readonly [string, string]> = [
      ['distance', 'ST_Distance({{self}}, {{arg0}})'],
      ['distanceSphere', 'ST_DistanceSphere({{self}}, {{arg0}})'],
      ['contains', 'ST_Contains({{self}}, {{arg0}})'],
      ['within', 'ST_Within({{self}}, {{arg0}})'],
      ['intersects', 'ST_Intersects({{self}}, {{arg0}})'],
      ['intersectsBbox', '({{self}} && {{arg0}})'],
    ];

    for (const [method, template] of cases) {
      const op = operations.find((o) => o.method === method);
      expect(op, method).toBeDefined();
      const expr = op?.impl(
        ParamRef.of({ type: 'Point', coordinates: [0, 0] }, { codecId: 'pg/geometry@1' }) as never,
        { type: 'Point', coordinates: [1, 1] } as never,
      ) as unknown as { buildAst(): OperationExpr };
      const ast = expr.buildAst();
      expect(ast).toBeInstanceOf(OperationExpr);
      expect(ast.lowering).toEqual({
        targetFamily: 'sql',
        strategy: 'function',
        template,
      });
    }
  });

  it('dwithin impl has three-argument template', () => {
    const op = postgisDescriptor.queryOperations!().find((o) => o.method === 'dwithin');
    expect(op).toBeDefined();
    const expr = op?.impl(
      ParamRef.of({ type: 'Point', coordinates: [0, 0] }, { codecId: 'pg/geometry@1' }) as never,
      { type: 'Point', coordinates: [1, 1] } as never,
      ParamRef.of(1000, { codecId: 'pg/float8@1' }) as never,
    ) as unknown as { buildAst(): OperationExpr };
    const ast = expr.buildAst();
    expect(ast.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'function',
      template: 'ST_DWithin({{self}}, {{arg0}}, {{arg1}})',
    });
  });

  it('operations register into a SqlOperationRegistry', () => {
    const operations = postgisDescriptor.queryOperations!();
    const registry = createSqlOperationRegistry();
    for (const op of operations) registry.register(op);

    const entries = registry.entries();
    expect(entries['distance']).toBeDefined();
    expect(entries['dwithin']).toBeDefined();
    expect(entries['intersectsBbox']).toBeDefined();
  });

  it('codecs register into a CodecRegistry', () => {
    const descriptorCodecs = postgisDescriptor.codecs();
    const registry = createCodecRegistry();
    for (const codec of descriptorCodecs.values()) registry.register(codec);
    expect(registry.get('pg/geometry@1')).toBeDefined();
  });

  it('instance is minimal (identity only)', () => {
    const instance = postgisDescriptor.create();
    expect(instance.familyId).toBe('sql');
    expect(instance.targetId).toBe('postgres');
  });
});
