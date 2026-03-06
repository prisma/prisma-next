import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  enumColumn,
  enumType,
  jsonb,
  textColumn,
  timestamptzColumn,
  varcharColumn,
} from '@prisma-next/adapter-postgres/column-types';
import { defineContract } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const accountStatusType = enumType('account_status', ['ACTIVE', 'INVITED', 'SUSPENDED']);
const projectVisibilityType = enumType('project_visibility', ['PRIVATE', 'TEAM', 'PUBLIC']);

const accountStatusColumn = enumColumn('AccountStatus', 'account_status');
const projectVisibilityColumn = enumColumn('ProjectVisibility', 'project_visibility');

export const contract = defineContract<CodecTypes>()
  .target(postgresPack)
  .storageType('AccountStatus', accountStatusType)
  .storageType('ProjectVisibility', projectVisibilityType)
  .table('account', (t) =>
    t
      .generated('id', {
        type: textColumn,
        generated: { kind: 'generator', id: 'ulid' },
      })
      .column('email', { type: varcharColumn(320), nullable: false })
      .column('status', { type: accountStatusColumn, nullable: false })
      .column('profile', { type: jsonb(), nullable: true })
      .column('createdAt', {
        type: timestamptzColumn,
        default: { kind: 'function', expression: 'now()' },
      })
      .primaryKey(['id'])
      .unique(['email']),
  )
  .table('project', (t) =>
    t
      .generated('id', {
        type: textColumn,
        generated: { kind: 'generator', id: 'ulid' },
      })
      .column('accountId', { type: textColumn, nullable: false })
      .column('name', { type: textColumn, nullable: false })
      .column('visibility', { type: projectVisibilityColumn, nullable: false })
      .column('metadata', { type: jsonb(), nullable: true })
      .column('createdAt', {
        type: timestamptzColumn,
        default: { kind: 'function', expression: 'now()' },
      })
      .primaryKey(['id'])
      .index(['accountId'])
      .foreignKey(['accountId'], { table: 'account', columns: ['id'] }),
  )
  .model('Account', 'account', (m) =>
    m
      .field('id', 'id')
      .field('email', 'email')
      .field('status', 'status')
      .field('profile', 'profile')
      .field('createdAt', 'createdAt'),
  )
  .model('Project', 'project', (m) =>
    m
      .field('id', 'id')
      .field('accountId', 'accountId')
      .field('name', 'name')
      .field('visibility', 'visibility')
      .field('metadata', 'metadata')
      .field('createdAt', 'createdAt'),
  )
  .build();
