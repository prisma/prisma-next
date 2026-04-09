import {
  enumType,
  jsonb,
  textColumn,
  timestamptzColumn,
  varcharColumn,
} from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const types = {
  AccountStatus: enumType('account_status', ['ACTIVE', 'INVITED', 'SUSPENDED']),
  ProjectVisibility: enumType('project_visibility', ['PRIVATE', 'TEAM', 'PUBLIC']),
} as const;

const Account = model('Account', {
  fields: {
    id: field
      .generated({
        type: textColumn,
        generated: { kind: 'generator', id: 'ulid' },
      })
      .id(),
    email: field.column(varcharColumn(320)).unique(),
    status: field.namedType(types.AccountStatus),
    profile: field.column(jsonb()).optional(),
    createdAt: field.column(timestamptzColumn).defaultSql('now()'),
  },
}).sql({ table: 'account' });

const Project = model('Project', {
  fields: {
    id: field
      .generated({
        type: textColumn,
        generated: { kind: 'generator', id: 'ulid' },
      })
      .id(),
    accountId: field.column(textColumn),
    name: field.column(textColumn),
    visibility: field.namedType(types.ProjectVisibility),
    metadata: field.column(jsonb()).optional(),
    createdAt: field.column(timestamptzColumn).defaultSql('now()'),
  },
}).sql(({ cols, constraints }) => ({
  table: 'project',
  indexes: [constraints.index(cols.accountId)],
  foreignKeys: [constraints.foreignKey(cols.accountId, Account.refs.id)],
}));

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  types,
  models: {
    Account,
    Project,
  },
});
