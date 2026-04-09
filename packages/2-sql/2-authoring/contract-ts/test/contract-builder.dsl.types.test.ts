import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import { describe, expectTypeOf, it } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';

import { columnDescriptor } from './helpers/column-descriptor';

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const int4Column = columnDescriptor('pg/int4@1');

describe('contract DSL type surface', () => {
  it('preserves the typed contract result at the defineContract boundary', () => {
    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expectTypeOf(contract.target).toEqualTypeOf<'postgres'>();
    expectTypeOf(contract.targetFamily).toEqualTypeOf<'sql'>();
    expectTypeOf(contract.models.User.storage.table).toEqualTypeOf<'user'>();
  });
});
