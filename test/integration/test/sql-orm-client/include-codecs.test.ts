import {
  byteaColumn,
  int4Column,
  timestampColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { defineContract, field, model, rel } from '@prisma-next/postgres/contract-builder';
import { Collection } from '@prisma-next/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withCollectionRuntime } from './integration-helpers';

const Project = model('Project', {
  fields: {
    id: field.column(int4Column).id(),
    wrappedDek: field.column(byteaColumn).column('wrapped_dek').optional(),
    deletedAt: field.column(timestampColumn).column('deleted_at').optional(),
    deletedAtTz: field.column(timestamptzColumn).column('deleted_at_tz').optional(),
  },
}).sql({ table: 'codec_projects' });

const Branch = model('Branch', {
  fields: {
    id: field.column(int4Column).id(),
    projectId: field.column(int4Column).column('project_id'),
  },
  relations: {
    project: rel.belongsTo(Project, { from: 'projectId', to: 'id' }),
  },
}).sql({ table: 'codec_branches' });

const contract = defineContract({ models: { Project, Branch } });
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

describe('integration/include codecs', () => {
  it(
    'decodes bytea child columns and preserves timestamp JSON text',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await runtime.query('drop table if exists codec_branches');
        await runtime.query('drop table if exists codec_projects');
        await runtime.query(`
          create table codec_projects (
            id integer primary key,
            wrapped_dek bytea,
            deleted_at timestamp,
            deleted_at_tz timestamptz
          )
        `);
        await runtime.query(`
          create table codec_branches (
            id integer primary key,
            project_id integer not null
          )
        `);
        await runtime.query(`
          insert into codec_projects (id, wrapped_dek, deleted_at, deleted_at_tz)
          values (
            10,
            decode('01020304', 'hex'),
            timestamp '2026-07-09 15:23:33.037',
            timestamptz '2026-07-09 15:23:33.037+00'
          )
        `);
        await runtime.query('insert into codec_branches (id, project_id) values (1, 10)');

        const branches = new Collection({ runtime, context }, 'Branch', { namespaceId: 'public' });
        const rows = await branches
          .select('id')
          .include('project', (project) => project.select('wrappedDek', 'deletedAt', 'deletedAtTz'))
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            project: {
              wrappedDek: new Uint8Array([1, 2, 3, 4]),
              deletedAt: '2026-07-09T15:23:33.037',
              deletedAtTz: '2026-07-09T15:23:33.037+00:00',
            },
          },
        ]);
      }, contract);
    },
    timeouts.spinUpPpgDev,
  );
});
