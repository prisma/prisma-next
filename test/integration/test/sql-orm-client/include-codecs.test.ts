import {
  byteaColumn,
  int4Column,
  timestampColumn,
  timestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import type { JsonValue } from '@prisma-next/contract/types';
import {
  CodecDescriptorImpl,
  type CodecInstanceContext,
  type ColumnTypeDescriptor,
  voidParamsSchema,
} from '@prisma-next/framework-components/codec';
import { defineContract, field, model, rel } from '@prisma-next/postgres/contract-builder';
import { Collection } from '@prisma-next/sql-orm-client';
import {
  type CodecCallContext,
  type SqlCodecCallContext,
  SqlCodecImpl,
} from '@prisma-next/sql-relational-core/ast';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withCollectionRuntime } from './integration-helpers';

const TEST_INCLUDED_TEXT_CODEC_ID = 'test/included-text@1' as const;

class IncludedTextCodec extends SqlCodecImpl<
  typeof TEST_INCLUDED_TEXT_CODEC_ID,
  readonly ['textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }

  override async decodeFromJson(value: unknown, _ctx: SqlCodecCallContext): Promise<string> {
    if (typeof value !== 'string') {
      throw new TypeError(`expected included text JSON value, got ${typeof value}`);
    }
    return `decoded-from-json:${value}`;
  }

  encodeJson(value: string): JsonValue {
    return value;
  }

  decodeJson(json: JsonValue): string {
    if (typeof json !== 'string') {
      throw new TypeError(`expected included text contract value, got ${typeof json}`);
    }
    return json;
  }
}

class IncludedTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = TEST_INCLUDED_TEXT_CODEC_ID;
  override readonly traits = ['textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;

  override factory(): (ctx: CodecInstanceContext) => IncludedTextCodec {
    return () => new IncludedTextCodec(this);
  }
}

const includedTextDescriptor = new IncludedTextDescriptor();
const includedTextColumn = {
  codecId: TEST_INCLUDED_TEXT_CODEC_ID,
  nativeType: 'text',
} as const satisfies ColumnTypeDescriptor;

const includedTextExtension: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  id: 'test-included-text',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',
  codecs: () => [includedTextDescriptor],
  create() {
    return { familyId: 'sql', targetId: 'postgres' };
  },
};

const Project = model('Project', {
  fields: {
    id: field.column(int4Column).id(),
    wrappedDek: field.column(byteaColumn).column('wrapped_dek').optional(),
    deletedAt: field.column(timestampColumn).column('deleted_at').optional(),
    deletedAtTz: field.column(timestamptzColumn).column('deleted_at_tz').optional(),
    customText: field.column(includedTextColumn).column('custom_text').optional(),
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
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensionPacks: [includedTextExtension],
  }),
});

describe('integration/include codecs', () => {
  it(
    'delegates child JSON values to codecs and preserves timestamp JSON text',
    async () => {
      await withCollectionRuntime(
        async (runtime) => {
          await runtime.query('drop table if exists codec_branches');
          await runtime.query('drop table if exists codec_projects');
          await runtime.query(`
          create table codec_projects (
            id integer primary key,
            wrapped_dek bytea,
            deleted_at timestamp,
            deleted_at_tz timestamptz,
            custom_text text
          )
        `);
          await runtime.query(`
          create table codec_branches (
            id integer primary key,
            project_id integer not null
          )
        `);
          await runtime.query(`
          insert into codec_projects (id, wrapped_dek, deleted_at, deleted_at_tz, custom_text)
          values (
            10,
            decode('01020304', 'hex'),
            timestamp '2026-07-09 15:23:33.037',
            timestamptz '2026-07-09 15:23:33.037+00',
            'extension value'
          )
        `);
          await runtime.query('insert into codec_branches (id, project_id) values (1, 10)');

          const branches = new Collection({ runtime, context }, 'Branch', {
            namespaceId: 'public',
          });
          const rows = await branches
            .select('id')
            .include('project', (project) =>
              project.select('wrappedDek', 'deletedAt', 'deletedAtTz', 'customText'),
            )
            .all();

          expect(rows).toEqual([
            {
              id: 1,
              project: {
                wrappedDek: new Uint8Array([1, 2, 3, 4]),
                deletedAt: '2026-07-09T15:23:33.037',
                deletedAtTz: '2026-07-09T15:23:33.037+00:00',
                customText: 'decoded-from-json:extension value',
              },
            },
          ]);
        },
        contract,
        [includedTextExtension],
      );
    },
    timeouts.spinUpPpgDev,
  );
});
