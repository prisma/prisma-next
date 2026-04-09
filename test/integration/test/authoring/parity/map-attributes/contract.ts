import { int4Column } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const Team = model('Team', {
  fields: {
    id: field.column(int4Column).column('team_id').id(),
  },
}).sql({ table: 'org_team' });

const Member = model('Member', {
  fields: {
    id: field.column(int4Column).column('member_id').id(),
    teamId: field.column(int4Column).column('team_ref'),
  },
  relations: {
    team: rel.belongsTo(Team, { from: 'teamId', to: 'id' }).sql({
      fk: {
        name: 'team_member_team_ref_fkey',
        onDelete: 'cascade',
        onUpdate: 'cascade',
      },
    }),
  },
})
  .attributes(({ fields, constraints }) => ({
    uniques: [constraints.unique([fields.teamId, fields.id])],
  }))
  .sql(({ cols, constraints }) => ({
    table: 'team_member',
    indexes: [constraints.index(cols.teamId)],
  }));

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: {
    Team,
    Member,
  },
});
