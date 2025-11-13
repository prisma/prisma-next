import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { loadContractFromTs } from '@prisma-next/cli';
import {
  assembleOperationRegistryFromPacks,
  extractCodecTypeImportsFromPacks,
  extractExtensionIdsFromPacks,
  extractOperationTypeImportsFromPacks,
} from '@prisma-next/cli/pack-assembly';
import type { ResultType } from '@prisma-next/contract/types';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres/runtime';
import { emit } from '@prisma-next/emitter';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import sqlFamilyDescriptor from '@prisma-next/family-sql/cli';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { IncludeChildBuilder, JoinOnBuilder } from '@prisma-next/sql-lane';
import { sql } from '@prisma-next/sql-lane';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { budgets, createRuntime, createRuntimeContext } from '@prisma-next/sql-runtime';
import { timeouts, withClient, withDevDatabase } from '@prisma-next/test-utils';
import { Pool } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadExtensionPacks } from '../../../packages/framework/tooling/cli/src/pack-loading';
import { stampMarker } from '../scripts/stamp-marker';
import type { Contract } from '../src/prisma/contract.d';

let contract: ReturnType<typeof validateContract>;

beforeAll(async () => {
  const contractPath = resolve(__dirname, '../prisma/contract.ts');
  const outputDir = resolve(__dirname, '../src/prisma');
  const adapterPath = resolve(__dirname, '../../../packages/targets/postgres-adapter');
  const pgvectorPath = resolve(__dirname, '../../../packages/extensions/pgvector');

  const contractIR = await loadContractFromTs(contractPath);
  const packs = loadExtensionPacks(adapterPath, [pgvectorPath]);
  const operationRegistry = assembleOperationRegistryFromPacks(packs, sqlFamilyDescriptor);
  const codecTypeImports = extractCodecTypeImportsFromPacks(packs);
  const operationTypeImports = extractOperationTypeImportsFromPacks(packs);
  const extensionIds = extractExtensionIdsFromPacks(packs);

  const result = await emit(
    contractIR,
    {
      outputDir,
      operationRegistry,
      codecTypeImports,
      operationTypeImports,
      extensionIds,
    },
    sqlTargetFamilyHook,
  );

  mkdirSync(outputDir, { recursive: true });

  const contractJson = JSON.parse(result.contractJson);

  writeFileSync(join(outputDir, 'contract.json'), JSON.stringify(contractJson, null, 2), 'utf-8');
  writeFileSync(join(outputDir, 'contract.d.ts'), result.contractDts, 'utf-8');

  contract = validateContract<Contract>(contractJson);
}, timeouts.typeScriptCompilation);

describe('runtime execute integration', () => {
  it(
    'streams rows and enforces marker verification',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        const adapter = createPostgresAdapter();
        const pool = new Pool({ connectionString });
        const driver = createPostgresDriverFromOptions({
          connect: { pool },
          cursor: { disabled: true },
        });
        const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'always', requireMarker: true },
          plugins: [
            budgets({
              maxRows: 10_000,
              defaultTableRows: 10_000,
              tableRows: { user: 10_000, post: 10_000 },
            }),
          ],
        });

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client: import('pg').Client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query(
              'create table if not exists "post" (id serial primary key, title text not null, "userId" int4 not null, "createdAt" timestamptz not null default now(), constraint post_userId_fkey foreign key ("userId") references "user"(id))',
            );
            await client.query('truncate table "post", "user" restart identity cascade');
            await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
              'alice@example.com',
            ]);
          });

          const rowCount = await withClient(
            connectionString,
            async (client: import('pg').Client) => {
              const result = await client.query('select count(*)::int as count from "user"');
              return result.rows[0]?.count as number;
            },
          );
          expect(rowCount).toBe(1);

          const tables = schema(context).tables;
          const userTable = tables['user']!;
          const plan = sql({ context })
            .from(tables['user']!)
            .select({
              id: userTable.columns['id']!,
              email: userTable.columns['email']!,
            })
            .limit(10)
            .build();

          type PlanRow = ResultType<typeof plan>;
          const rows: PlanRow[] = [];
          for await (const row of runtime.execute(plan)) {
            rows.push(row);
          }

          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ email: 'alice@example.com' });

          const root = sql({ context });
          const templatePlan = root.raw.with({ annotations: { limit: 1 } })`
          select id, email from "user"
          where email = ${'alice@example.com'}
          limit ${1}
        `;

          type TemplatePlanRow = ResultType<typeof templatePlan>;
          const templateRows: TemplatePlanRow[] = [];
          for await (const row of runtime.execute(templatePlan)) {
            templateRows.push(row);
          }
          expect(templateRows).toHaveLength(1);

          const functionPlan = root.raw('select id from "user" where email = $1 limit $2', {
            params: ['alice@example.com', 1],
            refs: { tables: ['user'], columns: [{ table: 'user', column: 'email' }] },
            annotations: { intent: 'report', limit: 1 },
          });

          type FunctionPlanRow = ResultType<typeof functionPlan>;
          const functionRows: FunctionPlanRow[] = [];
          for await (const row of runtime.execute(functionPlan)) {
            functionRows.push(row);
          }
          expect(functionRows).toHaveLength(1);

          await stampMarker({
            connectionString,
            coreHash: 'sha256:mismatched-core',
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await expect(async () => {
            const iterator = runtime.execute(plan)[Symbol.asyncIterator]();
            await iterator.next();
          }).rejects.toMatchObject({ code: 'CONTRACT.MARKER_MISMATCH' });
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.typeScriptCompilation * 2,
  );

  it(
    'infers correct types from query plans',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        const adapter = createPostgresAdapter();
        const pool = new Pool({ connectionString });
        const driver = createPostgresDriverFromOptions({
          connect: { pool },
          cursor: { disabled: true },
        });
        const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: false },
          plugins: [
            budgets({
              maxRows: 10_000,
              defaultTableRows: 10_000,
              tableRows: { user: 10_000, post: 10_000 },
            }),
          ],
        });

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client: import('pg').Client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query(
              'create table if not exists "post" (id serial primary key, title text not null, "userId" int4 not null, "createdAt" timestamptz not null default now(), constraint post_userId_fkey foreign key ("userId") references "user"(id))',
            );
            await client.query('truncate table "post", "user" restart identity cascade');
            await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
              'alice@example.com',
            ]);
            await client.query(
              'insert into "post" (title, "userId", "createdAt") values ($1, $2, now())',
              ['First Post', 1],
            );
          });

          const tables = schema(context).tables;
          const userTable = tables['user']!;
          const postTable = tables['post']!;

          const userPlan = sql({ context })
            .from(userTable)
            .select({
              id: userTable.columns['id']!,
              email: userTable.columns['email']!,
              createdAt: userTable.columns['createdAt']!,
            })
            .limit(10)
            .build();

          type UserRow = ResultType<typeof userPlan>;

          const postPlan = sql({ context })
            .from(postTable)
            .where(postTable.columns['userId']!.eq(param('userId')))
            .select({
              id: postTable.columns['id']!,
              title: postTable.columns['title']!,
              userId: postTable.columns['userId']!,
              createdAt: postTable.columns['createdAt']!,
            })
            .limit(1)
            .build({ params: { userId: 1 } });

          type PostRow = ResultType<typeof postPlan>;

          const userRows: UserRow[] = [];
          for await (const row of runtime.execute(userPlan)) {
            userRows.push(row);
          }
          expect(userRows).toHaveLength(1);
          expect(userRows[0]).toMatchObject({ email: 'alice@example.com' });

          const postRows: PostRow[] = [];
          for await (const row of runtime.execute(postPlan)) {
            postRows.push(row);
          }
          expect(postRows).toHaveLength(1);
          expect(postRows[0]).toMatchObject({ title: 'First Post', userId: 1 });
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'enforces row budget on unbounded queries',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        const adapter = createPostgresAdapter();
        const pool = new Pool({ connectionString });
        const driver = createPostgresDriverFromOptions({
          connect: { pool },
          cursor: { disabled: true },
        });
        const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: false },
          plugins: [
            budgets({
              maxRows: 50,
              defaultTableRows: 10_000,
              tableRows: { user: 10_000, post: 10_000 },
            }),
          ],
        });

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client: import('pg').Client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
            for (let i = 0; i < 100; i++) {
              await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
                `user${i}@example.com`,
              ]);
            }
          });

          const tables = schema(context).tables;
          const userTable = tables['user']!;
          const unboundedPlan = sql({ context })
            .from(tables['user']!)
            .select({
              id: userTable.columns['id']!,
              email: userTable.columns['email']!,
            })
            .build();

          await expect(async () => {
            for await (const _row of runtime.execute(unboundedPlan)) {
              // Should not reach here
            }
          }).rejects.toMatchObject({
            code: 'BUDGET.ROWS_EXCEEDED',
            category: 'BUDGET',
          });

          const boundedPlan = sql({ context })
            .from(tables['user']!)
            .select({
              id: userTable.columns['id']!,
              email: userTable.columns['email']!,
            })
            .limit(10)
            .build();

          type BoundedPlanRow = ResultType<typeof boundedPlan>;
          const rows: BoundedPlanRow[] = [];
          for await (const row of runtime.execute(boundedPlan)) {
            rows.push(row);
          }
          expect(rows.length).toBeLessThanOrEqual(10);
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'enforces streaming row budget',
    async () => {
      await withDevDatabase(async ({ connectionString }: { connectionString: string }) => {
        const adapter = createPostgresAdapter();
        const pool = new Pool({ connectionString });
        const driver = createPostgresDriverFromOptions({
          connect: { pool },
          cursor: { disabled: true },
        });
        const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: false },
          plugins: [
            budgets({
              maxRows: 10,
              defaultTableRows: 10_000,
              tableRows: { user: 10_000, post: 10_000 },
            }),
          ],
        });

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client: import('pg').Client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query('truncate table "user" restart identity');
            for (let i = 0; i < 50; i++) {
              await client.query('insert into "user" (email, "createdAt") values ($1, now())', [
                `user${i}@example.com`,
              ]);
            }
          });

          const tables = schema(context).tables;
          const userTable = tables['user']!;
          const plan = sql({ context })
            .from(tables['user']!)
            .select({
              id: userTable.columns['id']!,
              email: userTable.columns['email']!,
            })
            .limit(50)
            .build();

          await expect(async () => {
            for await (const _row of runtime.execute(plan)) {
              // Will throw on 11th row
            }
          }).rejects.toMatchObject({
            code: 'BUDGET.ROWS_EXCEEDED',
            category: 'BUDGET',
          });
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'includeMany returns users with nested posts array',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const adapter = createPostgresAdapter();
        const pool = new Pool({ connectionString });
        const driver = createPostgresDriverFromOptions({
          connect: { pool },
          cursor: { disabled: true },
        });
        const context = createRuntimeContext({ contract, adapter, extensions: [pgvector()] });
        const runtime = createRuntime({
          context,
          adapter,
          driver,
          verify: { mode: 'onFirstUse', requireMarker: false },
          plugins: [
            budgets({
              maxRows: 10_000,
              defaultTableRows: 10_000,
              tableRows: { user: 10_000, post: 10_000 },
            }),
          ],
        });

        try {
          await stampMarker({
            connectionString,
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
          });

          await withClient(connectionString, async (client) => {
            await client.query(
              'create table if not exists "user" (id serial primary key, email text not null unique, "createdAt" timestamptz not null default now())',
            );
            await client.query(
              'create table if not exists "post" (id serial primary key, title text not null, "userId" int4 not null, "createdAt" timestamptz not null default now(), constraint post_userId_fkey foreign key ("userId") references "user"(id))',
            );
            await client.query('truncate table "post", "user" restart identity cascade');
            await client.query(
              'insert into "user" (email, "createdAt") values ($1, now()), ($2, now())',
              ['alice@example.com', 'bob@example.com'],
            );
            await client.query(
              'insert into "post" (title, "userId", "createdAt") values ($1, $2, now()), ($3, $2, now()), ($4, $5, now())',
              ['First Post', 1, 'Second Post', 'Third Post', 2],
            );
          });

          const tables = schema(context).tables;
          const userTable = tables['user']!;
          const postTable = tables['post']!;

          const plan = sql({ context })
            .from(userTable)
            .includeMany(
              postTable,
              (on: JoinOnBuilder) =>
                on.eqCol(userTable.columns['id']!, postTable.columns['userId']!),
              (child: IncludeChildBuilder) =>
                child
                  .select({
                    id: postTable.columns['id']!,
                    title: postTable.columns['title']!,
                    createdAt: postTable.columns['createdAt']!,
                  })
                  .orderBy(postTable.columns['createdAt']!.desc()),
              { alias: 'posts' },
            )
            .select({
              id: userTable.columns['id']!,
              email: userTable.columns['email']!,
              createdAt: userTable.columns['createdAt']!,
              posts: true,
            })
            .limit(10)
            .build();

          type Row = ResultType<typeof plan>;
          const rows: Row[] = [];
          for await (const row of runtime.execute(plan)) {
            rows.push(row);
          }

          expect(rows).toHaveLength(2);
          expect(rows[0]).toHaveProperty('id');
          expect(rows[0]).toHaveProperty('email');
          expect(rows[0]).toHaveProperty('posts');
          expect(Array.isArray(rows[0]!.posts)).toBe(true);

          const alice = rows.find((r) => r.email === 'alice@example.com');
          expect(alice).toBeDefined();
          expect(alice!.posts).toHaveLength(2);
          expect(alice!.posts[0]).toHaveProperty('id');
          expect(alice!.posts[0]).toHaveProperty('title');
          expect(alice!.posts[0]).toHaveProperty('createdAt');
          expect(typeof alice!.posts[0]!.id).toBe('number');
          expect(typeof alice!.posts[0]!.title).toBe('string');

          const bob = rows.find((r) => r.email === 'bob@example.com');
          expect(bob).toBeDefined();
          expect(bob!.posts).toHaveLength(1);
          expect(bob!.posts[0]!.title).toBe('Third Post');
        } finally {
          await runtime.close();
        }
      }, {});
    },
    timeouts.spinUpPpgDev,
  );
});
