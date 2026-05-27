import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { Collection } from '../src/collection';
import type {
  CreateInput,
  DefaultModelRow,
  InferRootRow,
  ResolvedCreateInput,
  VariantCreateInput,
} from '../src/types';

interface PolyStorage {
  readonly tables: {
    readonly tasks: {
      columns: {
        readonly id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: false;
        };
        readonly title: {
          readonly nativeType: 'text';
          readonly codecId: 'pg/text@1';
          readonly nullable: false;
        };
        readonly type: {
          readonly nativeType: 'text';
          readonly codecId: 'pg/text@1';
          readonly nullable: false;
        };
        readonly severity: {
          readonly nativeType: 'text';
          readonly codecId: 'pg/text@1';
          readonly nullable: true;
        };
      };
      primaryKey: { columns: readonly ['id'] };
      uniques: readonly [];
      indexes: readonly [];
      foreignKeys: readonly [];
    };
    readonly features: {
      columns: {
        readonly id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: false;
        };
        readonly priority: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: false;
        };
      };
      primaryKey: { columns: readonly ['id'] };
      uniques: readonly [];
      indexes: readonly [];
      foreignKeys: readonly [];
    };
    readonly plain_model: {
      columns: {
        readonly id: {
          readonly nativeType: 'int4';
          readonly codecId: 'pg/int4@1';
          readonly nullable: false;
        };
        readonly name: {
          readonly nativeType: 'text';
          readonly codecId: 'pg/text@1';
          readonly nullable: false;
        };
      };
      primaryKey: { columns: readonly ['id'] };
      uniques: readonly [];
      indexes: readonly [];
      foreignKeys: readonly [];
    };
  };
  readonly storageHash: string;
}

type R = Record<string, never>;

type PolyContract = Contract<
  PolyStorage & SqlStorage,
  {
    readonly Task: {
      readonly fields: {
        readonly id: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
          readonly nullable: false;
        };
        readonly title: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: false;
        };
        readonly type: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: false;
        };
      };
      readonly relations: R;
      readonly storage: {
        readonly table: 'tasks';
        readonly fields: {
          readonly id: { readonly column: 'id' };
          readonly title: { readonly column: 'title' };
          readonly type: { readonly column: 'type' };
        };
      };
      readonly discriminator: { readonly field: 'type' };
      readonly variants: {
        readonly Bug: { readonly value: 'bug' };
        readonly Feature: { readonly value: 'feature' };
      };
    };
    readonly Bug: {
      readonly fields: {
        readonly severity: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: true;
        };
      };
      readonly relations: R;
      readonly storage: {
        readonly table: 'tasks';
        readonly fields: {
          readonly severity: { readonly column: 'severity' };
        };
      };
      readonly base: 'Task';
    };
    readonly Feature: {
      readonly fields: {
        readonly priority: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
          readonly nullable: false;
        };
      };
      readonly relations: R;
      readonly storage: {
        readonly table: 'features';
        readonly fields: {
          readonly priority: { readonly column: 'priority' };
        };
      };
      readonly base: 'Task';
    };
    readonly PlainModel: {
      readonly fields: {
        readonly id: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
          readonly nullable: false;
        };
        readonly name: {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
          readonly nullable: false;
        };
      };
      readonly relations: R;
      readonly storage: {
        readonly table: 'plain_model';
        readonly fields: {
          readonly id: { readonly column: 'id' };
          readonly name: { readonly column: 'name' };
        };
      };
    };
  }
>;

test('InferRootRow for polymorphic base returns discriminated union', () => {
  type TaskRow = InferRootRow<PolyContract, 'Task'>;
  expectTypeOf<TaskRow>().toExtend<{ title: unknown; type: 'bug' | 'feature' }>();
});

test('InferRootRow discriminator field carries literal union type', () => {
  type TaskRow = InferRootRow<PolyContract, 'Task'>;
  expectTypeOf<TaskRow['type']>().toEqualTypeOf<'bug' | 'feature'>();
});

test('discriminator narrows to Bug fields exclusively', () => {
  type TaskRow = InferRootRow<PolyContract, 'Task'>;
  const r = {} as unknown as TaskRow;
  if (r.type === 'bug') {
    expectTypeOf<typeof r>().toHaveProperty('severity');
    // @ts-expect-error priority only exists on Feature variant
    r.priority;
  }
});

test('discriminator narrows to Feature fields exclusively', () => {
  type TaskRow = InferRootRow<PolyContract, 'Task'>;
  const r = {} as unknown as TaskRow;
  if (r.type === 'feature') {
    expectTypeOf<typeof r>().toHaveProperty('priority');
    // @ts-expect-error severity only exists on Bug variant
    r.severity;
  }
});

test('InferRootRow for non-polymorphic model equals DefaultModelRow', () => {
  type PlainRow = InferRootRow<PolyContract, 'PlainModel'>;
  type Expected = DefaultModelRow<PolyContract, 'PlainModel'>;
  expectTypeOf<PlainRow>().toEqualTypeOf<Expected>();
});

test('DefaultModelRow still works for non-polymorphic model', () => {
  type PlainRow = DefaultModelRow<PolyContract, 'PlainModel'>;
  expectTypeOf<PlainRow>().toHaveProperty('id');
  expectTypeOf<PlainRow>().toHaveProperty('name');
});

test('Collection default Row for polymorphic model is discriminated union', () => {
  type TaskCollection = Collection<PolyContract, 'Task'>;
  type TaskRow = TaskCollection extends { all(): infer R }
    ? R extends AsyncIterable<infer T>
      ? T
      : never
    : never;
  expectTypeOf<TaskRow['type']>().toEqualTypeOf<'bug' | 'feature'>();
});

test('Collection default Row for non-polymorphic model equals DefaultModelRow', () => {
  type PlainCollection = Collection<PolyContract, 'PlainModel'>;
  type PlainRow = PlainCollection extends { all(): infer R }
    ? R extends AsyncIterable<infer T>
      ? T
      : never
    : never;
  type Expected = DefaultModelRow<PolyContract, 'PlainModel'>;
  expectTypeOf<PlainRow>().toEqualTypeOf<Expected>();
});

// ---------------------------------------------------------------------------
// Write gating: polymorphic base create = never, variant create excludes discriminator
// ---------------------------------------------------------------------------

test('ResolvedCreateInput for polymorphic base (no variant) is never', () => {
  type BaseCreate = ResolvedCreateInput<PolyContract, 'Task', undefined>;
  expectTypeOf<BaseCreate>().toBeNever();
});

test('CreateInput for non-polymorphic model is unchanged', () => {
  type PlainCreate = CreateInput<PolyContract, 'PlainModel'>;
  expectTypeOf<PlainCreate>().toHaveProperty('id');
  expectTypeOf<PlainCreate>().toHaveProperty('name');
});

test('ResolvedCreateInput for non-polymorphic model equals CreateInput', () => {
  type Resolved = ResolvedCreateInput<PolyContract, 'PlainModel', undefined>;
  type Plain = CreateInput<PolyContract, 'PlainModel'>;
  expectTypeOf<Resolved>().toEqualTypeOf<Plain>();
});

test('VariantCreateInput includes base + variant fields minus discriminator', () => {
  type BugCreate = VariantCreateInput<PolyContract, 'Task', 'Bug'>;
  expectTypeOf<BugCreate>().toHaveProperty('title');
  expectTypeOf<BugCreate>().toHaveProperty('severity');
  expectTypeOf<BugCreate>().not.toHaveProperty('type');
});

test('VariantCreateInput for MTI variant includes base + variant fields minus discriminator', () => {
  type FeatureCreate = VariantCreateInput<PolyContract, 'Task', 'Feature'>;
  expectTypeOf<FeatureCreate>().toHaveProperty('title');
  expectTypeOf<FeatureCreate>().toHaveProperty('priority');
  expectTypeOf<FeatureCreate>().not.toHaveProperty('type');
});

test('ResolvedCreateInput with variant name equals VariantCreateInput', () => {
  type Resolved = ResolvedCreateInput<PolyContract, 'Task', 'Bug'>;
  type Direct = VariantCreateInput<PolyContract, 'Task', 'Bug'>;
  expectTypeOf<Resolved>().toEqualTypeOf<Direct>();
});
