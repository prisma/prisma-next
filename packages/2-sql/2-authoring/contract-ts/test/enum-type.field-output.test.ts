import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type {
  ExtractFieldInputTypes,
  ExtractFieldOutputTypes,
} from '@prisma-next/sql-contract/types';
import { describe, expectTypeOf, it } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';

// ---------------------------------------------------------------------------
// Minimal pack stubs (same as enum-type.authoring.test.ts)
// ---------------------------------------------------------------------------

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: { codecId: 'pg/text@1', nativeType: 'text' },
      },
    },
  },
} as const satisfies FamilyPackRef<'sql'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;

// ---------------------------------------------------------------------------
// Fixture: enum + model using enumType field
// ---------------------------------------------------------------------------

const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
const Status = enumType(
  'Status',
  pgText,
  member('Active', 'active'),
  member('Inactive', 'inactive'),
);

const enumContract = defineContract({
  family: sqlFamilyPack,
  target: postgresTargetPack,
  enums: { Role, Status },
  models: {
    User: model('User', {
      fields: {
        role: field.namedType(Role),
        status: field.namedType(Status).optional(),
      },
    }),
  },
});

// ---------------------------------------------------------------------------
// Literal-propagation hop 1: FieldOutputTypes carries the value union
// ---------------------------------------------------------------------------

describe('FieldOutputTypes: enum field narrows to value union', () => {
  type FOT = ExtractFieldOutputTypes<typeof enumContract>;

  it('non-nullable enum field is the value union (not string)', () => {
    expectTypeOf<FOT['User']['role']>().toEqualTypeOf<'user' | 'admin'>();
  });

  it('non-nullable enum field is not string', () => {
    expectTypeOf<FOT['User']['role']>().not.toEqualTypeOf<string>();
  });

  it('nullable enum field is value union | null', () => {
    expectTypeOf<FOT['User']['status']>().toEqualTypeOf<'active' | 'inactive' | null>();
  });

  it('nullable enum field is not string | null', () => {
    expectTypeOf<FOT['User']['status']>().not.toEqualTypeOf<string | null>();
  });
});

// ---------------------------------------------------------------------------
// Literal-propagation hop 2: FieldInputTypes carries the value union for writes
// ---------------------------------------------------------------------------

describe('FieldInputTypes: enum field write input narrows to value union', () => {
  type FIT = ExtractFieldInputTypes<typeof enumContract>;

  it('non-nullable enum field input is the value union', () => {
    expectTypeOf<FIT['User']['role']>().toEqualTypeOf<'user' | 'admin'>();
  });

  it('nullable enum field input is value union | null', () => {
    expectTypeOf<FIT['User']['status']>().toEqualTypeOf<'active' | 'inactive' | null>();
  });
});
