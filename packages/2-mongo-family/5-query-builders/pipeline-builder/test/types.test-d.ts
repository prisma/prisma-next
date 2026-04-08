import { expectTypeOf } from 'vitest';
import type {
  DocField,
  DocShape,
  ExtractDocShape,
  ModelToDocShape,
  ResolveRow,
  TypedAggExpr,
} from '../src/types';
import type { TestCodecTypes, TestContract } from './fixtures/test-contract';

describe('type machinery', () => {
  it('DocField has codecId and nullable', () => {
    expectTypeOf<DocField>().toHaveProperty('codecId');
    expectTypeOf<DocField>().toHaveProperty('nullable');
  });

  it('DocShape is a record of DocField', () => {
    expectTypeOf<DocShape>().toMatchTypeOf<Record<string, DocField>>();
  });

  it('ModelToDocShape derives correct shape from contract model', () => {
    type OrderShape = ModelToDocShape<TestContract, 'Order'>;

    expectTypeOf<OrderShape['_id']>().toEqualTypeOf<{
      readonly codecId: 'mongo/objectId@1';
      readonly nullable: false;
    }>();
    expectTypeOf<OrderShape['status']>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: false;
    }>();
    expectTypeOf<OrderShape['notes']>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: true;
    }>();
  });

  it('ResolveRow produces concrete types from DocShape and CodecTypes', () => {
    type OrderShape = ModelToDocShape<TestContract, 'Order'>;
    type Row = ResolveRow<OrderShape, TestCodecTypes>;

    expectTypeOf<Row['_id']>().toEqualTypeOf<string>();
    expectTypeOf<Row['status']>().toEqualTypeOf<string>();
    expectTypeOf<Row['amount']>().toEqualTypeOf<number>();
  });

  it('ResolveRow applies nullable correctly', () => {
    type OrderShape = ModelToDocShape<TestContract, 'Order'>;
    type Row = ResolveRow<OrderShape, TestCodecTypes>;

    expectTypeOf<Row['notes']>().toEqualTypeOf<string | null>();
  });

  it('ResolveRow falls back to unknown for missing codec', () => {
    type Shape = { readonly x: { readonly codecId: 'unknown/codec'; readonly nullable: false } };
    type Row = ResolveRow<Shape, TestCodecTypes>;

    expectTypeOf<Row['x']>().toEqualTypeOf<unknown>();
  });

  it('ExtractDocShape extracts field types from TypedAggExpr record', () => {
    type Exprs = {
      readonly total: TypedAggExpr<{
        readonly codecId: 'mongo/double@1';
        readonly nullable: false;
      }>;
      readonly name: TypedAggExpr<{
        readonly codecId: 'mongo/string@1';
        readonly nullable: false;
      }>;
    };
    type Shape = ExtractDocShape<Exprs>;

    expectTypeOf<Shape['total']>().toEqualTypeOf<{
      readonly codecId: 'mongo/double@1';
      readonly nullable: false;
    }>();
    expectTypeOf<Shape['name']>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: false;
    }>();
  });
});
