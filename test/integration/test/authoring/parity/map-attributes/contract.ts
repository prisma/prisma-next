import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .table('org_team', (t) =>
    t.column('team_id', { type: int4Column, nullable: false }).primaryKey(['team_id']),
  )
  .table('team_member', (t) =>
    t
      .column('member_id', { type: int4Column, nullable: false })
      .column('team_ref', { type: int4Column, nullable: false })
      .primaryKey(['member_id'])
      .index(['team_ref'])
      .unique(['team_ref', 'member_id'])
      .foreignKey(
        ['team_ref'],
        { table: 'org_team', columns: ['team_id'] },
        { name: 'team_member_team_ref_fkey', onDelete: 'cascade', onUpdate: 'cascade' },
      ),
  )
  .model('Team', 'org_team', (m) => m.field('id', 'team_id'))
  .model('Member', 'team_member', (m) =>
    m
      .field('id', 'member_id')
      .field('teamId', 'team_ref')
      .relation('team', {
        toModel: 'Team',
        toTable: 'org_team',
        cardinality: 'N:1',
        on: {
          parentTable: 'team_member',
          parentColumns: ['team_ref'],
          childTable: 'org_team',
          childColumns: ['team_id'],
        },
      }),
  )
  .build();
