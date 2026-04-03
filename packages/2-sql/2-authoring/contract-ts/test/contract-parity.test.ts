import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

describe('defineContract build output', () => {
  it('defineContract().build() omits _generated', () => {
    const built = defineContract()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column })
          .primaryKey(['id'])
          .column('email', { type: textColumn }),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    expect(built).not.toHaveProperty('_generated');
  });
});
