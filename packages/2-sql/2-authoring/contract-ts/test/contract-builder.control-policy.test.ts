import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
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

describe('defineContract defaultControl', () => {
  it('lowers defaultControl to Contract.defaultControl', () => {
    const built = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      defaultControl: 'external',
      models: {
        User: model('User', {
          fields: { id: field.column(int4Column).id() },
        }).sql({ table: 'app_user' }),
      },
    });

    expect(built.defaultControl).toBe('external');
  });

  it('omits defaultControl when unset', () => {
    const built = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      models: {
        User: model('User', {
          fields: { id: field.column(int4Column).id() },
        }).sql({ table: 'app_user' }),
      },
    });

    expect(built).not.toHaveProperty('defaultControl');
  });
});
