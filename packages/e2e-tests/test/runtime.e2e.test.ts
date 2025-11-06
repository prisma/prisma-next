import { describe, it, expect } from 'vitest';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';
import {
  createRuntime,
  ensureSchemaStatement,
  ensureTableStatement,
  writeContractMarker,
} from '@prisma-next/runtime';
import { createPostgresDriverFromOptions } from '@prisma-next/driver-postgres';
import { sql } from '@prisma-next/sql-query/sql';
import { schema, validateContract } from '@prisma-next/sql-query/schema';
import type { ResultType } from '@prisma-next/sql-query/types';
import { withDevDatabase, executeStatement } from '@prisma-next/runtime/test/utils';
import type { Contract } from './fixtures/generated/contract.d';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');

const execFileAsync = promisify(execFile);

describe('end-to-end query with emitted contract', { timeout: 30000 }, () => {
  const adapterPath = resolve(repoRoot, 'packages/adapter-postgres');
  const cliPath = resolve(repoRoot, 'packages/cli/dist/cli.js');
  const contractTsPath = resolve(__dirname, 'fixtures/contract.ts');

  it('returns multiple rows with correct types', async () => {
    // 1) Emit contract via CLI to temp output folder under package
    const outputDir = resolve(__dirname, '../.tmp-output');
    await execFileAsync('node', [
      cliPath,
      'emit',
      '--contract',
      contractTsPath,
      '--out',
      outputDir,
      '--adapter',
      adapterPath,
    ]);

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent);
    const contract = validateContract<Contract>(contractJson);

    // 2) Start dev DB and prepare schema/data
    await withDevDatabase(
      async ({ connectionString }) => {
        const client = new Client({ connectionString });
        await client.connect();
        try {
          await client.query('drop schema if exists prisma_contract cascade');
          await client.query('create schema if not exists public');
          await client.query('drop table if exists "user"');
          await client.query('create table "user" (id serial primary key, email text not null)');
          await client.query('insert into "user" (email) values ($1), ($2), ($3)', [
            'ada@example.com',
            'tess@example.com',
            'mike@example.com',
          ]);

          await executeStatement(client, ensureSchemaStatement);
          await executeStatement(client, ensureTableStatement);
          const write = writeContractMarker({
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
            contractJson: contract,
            canonicalVersion: 1,
          });
          await executeStatement(client, write.insert);

          // 3) Build plan and execute via runtime
          const adapter = createPostgresAdapter();
          const driver = createPostgresDriverFromOptions({
            connect: { client },
            cursor: { disabled: true },
          });
          const runtime = createRuntime({
            contract,
            adapter,
            driver,
            verify: { mode: 'onFirstUse', requireMarker: true },
          });

          const tables = schema<Contract, CodecTypes>(contract).tables;
          const user = tables['user']!;
          const plan = sql<Contract, CodecTypes>({ contract, adapter })
            .from(user)
            .select({ id: user.columns['id']!, email: user.columns['email']! })
            .build();

          type Row = ResultType<typeof plan>;
          const rows: Row[] = [];
          for await (const row of runtime.execute(plan)) {
            rows.push(row);
          }

          expect(rows.length).toBeGreaterThan(1);
          expect(rows[0]).toHaveProperty('id');
          expect(rows[0]).toHaveProperty('email');

          // Type sanity at runtime
          expect(typeof rows[0]!.id).toBe('number');
          expect(typeof rows[0]!.email).toBe('string');

          await runtime.close();
        } finally {
          await client.end();
        }
      },
      { acceleratePort: 54020, databasePort: 54021, shadowDatabasePort: 54022 },
    );
  });

  it('INNER JOIN returns matching rows', async () => {
    const outputDir = resolve(__dirname, '../.tmp-output');
    await execFileAsync('node', [
      cliPath,
      'emit',
      '--contract',
      contractTsPath,
      '--out',
      outputDir,
      '--adapter',
      adapterPath,
    ]);

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent);
    const contract = validateContract<Contract>(contractJson);

    await withDevDatabase(
      async ({ connectionString }) => {
        const client = new Client({ connectionString });
        await client.connect();
        try {
          await client.query('drop schema if exists prisma_contract cascade');
          await client.query('create schema if not exists public');
          await client.query('drop table if exists "comment"');
          await client.query('drop table if exists "post"');
          await client.query('drop table if exists "user"');
          await client.query('create table "user" (id serial primary key, email text not null)');
          await client.query(
            'create table "post" (id serial primary key, "userId" int4 not null, title text not null)',
          );
          await client.query('insert into "user" (email) values ($1), ($2), ($3)', [
            'ada@example.com',
            'tess@example.com',
            'mike@example.com',
          ]);
          await client.query(
            'insert into "post" ("userId", title) values ($1, $2), ($1, $3), ($4, $5)',
            [1, 'First Post', 'Second Post', 2, 'Third Post'],
          );

          await executeStatement(client, ensureSchemaStatement);
          await executeStatement(client, ensureTableStatement);
          const write = writeContractMarker({
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
            contractJson: contract,
            canonicalVersion: 1,
          });
          await executeStatement(client, write.insert);

          const adapter = createPostgresAdapter();
          const driver = createPostgresDriverFromOptions({
            connect: { client },
            cursor: { disabled: true },
          });
          const runtime = createRuntime({
            contract,
            adapter,
            driver,
            verify: { mode: 'onFirstUse', requireMarker: true },
          });

          const tables = schema<Contract, CodecTypes>(contract).tables;
          const user = tables['user']!;
          const post = tables['post']!;
          const plan = sql<Contract, CodecTypes>({ contract, adapter })
            .from(user)
            .innerJoin(post, (on) => on.eqCol(user.columns['id']!, post.columns['userId']!))
            .select({
              userId: user.columns['id']!,
              email: user.columns['email']!,
              postId: post.columns['id']!,
              title: post.columns['title']!,
            })
            .build();

          type Row = ResultType<typeof plan>;
          const rows: Row[] = [];
          for await (const row of runtime.execute(plan)) {
            rows.push(row);
          }

          expect(rows.length).toBe(3);
          expect(rows[0]).toHaveProperty('userId');
          expect(rows[0]).toHaveProperty('email');
          expect(rows[0]).toHaveProperty('postId');
          expect(rows[0]).toHaveProperty('title');
          expect(typeof rows[0]!.userId).toBe('number');
          expect(typeof rows[0]!.email).toBe('string');
          expect(typeof rows[0]!.postId).toBe('number');
          expect(typeof rows[0]!.title).toBe('string');

          expect(plan.meta.refs?.tables).toContain('user');
          expect(plan.meta.refs?.tables).toContain('post');
          expect(plan.meta.refs?.columns).toEqual(
            expect.arrayContaining([
              { table: 'user', column: 'id' },
              { table: 'post', column: 'userId' },
            ]),
          );

          await runtime.close();
        } finally {
          await client.end();
        }
      },
      { acceleratePort: 54030, databasePort: 54031, shadowDatabasePort: 54032 },
    );
  });

  it('LEFT JOIN returns all users including those without posts', async () => {
    const outputDir = resolve(__dirname, '../.tmp-output');
    await execFileAsync('node', [
      cliPath,
      'emit',
      '--contract',
      contractTsPath,
      '--out',
      outputDir,
      '--adapter',
      adapterPath,
    ]);

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent);
    const contract = validateContract<Contract>(contractJson);

    await withDevDatabase(
      async ({ connectionString }) => {
        const client = new Client({ connectionString });
        await client.connect();
        try {
          await client.query('drop schema if exists prisma_contract cascade');
          await client.query('create schema if not exists public');
          await client.query('drop table if exists "comment"');
          await client.query('drop table if exists "post"');
          await client.query('drop table if exists "user"');
          await client.query('create table "user" (id serial primary key, email text not null)');
          await client.query(
            'create table "post" (id serial primary key, "userId" int4 not null, title text not null)',
          );
          await client.query('insert into "user" (email) values ($1), ($2), ($3)', [
            'ada@example.com',
            'tess@example.com',
            'mike@example.com',
          ]);
          await client.query('insert into "post" ("userId", title) values ($1, $2)', [
            1,
            'First Post',
          ]);

          await executeStatement(client, ensureSchemaStatement);
          await executeStatement(client, ensureTableStatement);
          const write = writeContractMarker({
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
            contractJson: contract,
            canonicalVersion: 1,
          });
          await executeStatement(client, write.insert);

          const adapter = createPostgresAdapter();
          const driver = createPostgresDriverFromOptions({
            connect: { client },
            cursor: { disabled: true },
          });
          const runtime = createRuntime({
            contract,
            adapter,
            driver,
            verify: { mode: 'onFirstUse', requireMarker: true },
          });

          const tables = schema<Contract, CodecTypes>(contract).tables;
          const user = tables['user']!;
          const post = tables['post']!;
          const plan = sql<Contract, CodecTypes>({ contract, adapter })
            .from(user)
            .leftJoin(post, (on) => on.eqCol(user.columns['id']!, post.columns['userId']!))
            .select({
              userId: user.columns['id']!,
              email: user.columns['email']!,
              postId: post.columns['id']!,
              title: post.columns['title']!,
            })
            .build();

          type Row = ResultType<typeof plan>;
          const rows: Row[] = [];
          for await (const row of runtime.execute(plan)) {
            rows.push(row);
          }

          expect(rows.length).toBe(3);
          const adaRow = rows.find((r) => r.email === 'ada@example.com');
          const tessRow = rows.find((r) => r.email === 'tess@example.com');
          const mikeRow = rows.find((r) => r.email === 'mike@example.com');

          expect(adaRow).toBeDefined();
          expect(adaRow!.postId).not.toBeNull();
          expect(adaRow!.title).not.toBeNull();

          expect(tessRow).toBeDefined();
          expect(tessRow!.postId).toBeNull();
          expect(tessRow!.title).toBeNull();

          expect(mikeRow).toBeDefined();
          expect(mikeRow!.postId).toBeNull();
          expect(mikeRow!.title).toBeNull();

          expect(plan.meta.refs?.tables).toContain('user');
          expect(plan.meta.refs?.tables).toContain('post');

          await runtime.close();
        } finally {
          await client.end();
        }
      },
      { acceleratePort: 54040, databasePort: 54041, shadowDatabasePort: 54042 },
    );
  });

  it('RIGHT JOIN returns all posts including those without users', async () => {
    const outputDir = resolve(__dirname, '../.tmp-output');
    await execFileAsync('node', [
      cliPath,
      'emit',
      '--contract',
      contractTsPath,
      '--out',
      outputDir,
      '--adapter',
      adapterPath,
    ]);

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent);
    const contract = validateContract<Contract>(contractJson);

    await withDevDatabase(
      async ({ connectionString }) => {
        const client = new Client({ connectionString });
        await client.connect();
        try {
          await client.query('drop schema if exists prisma_contract cascade');
          await client.query('create schema if not exists public');
          await client.query('drop table if exists "comment"');
          await client.query('drop table if exists "post"');
          await client.query('drop table if exists "user"');
          await client.query('create table "user" (id serial primary key, email text not null)');
          await client.query(
            'create table "post" (id serial primary key, "userId" int4 not null, title text not null)',
          );
          await client.query('insert into "user" (email) values ($1)', ['ada@example.com']);
          await client.query('insert into "post" ("userId", title) values ($1, $2), ($3, $4)', [
            1,
            'First Post',
            999,
            'Orphan Post',
          ]);

          await executeStatement(client, ensureSchemaStatement);
          await executeStatement(client, ensureTableStatement);
          const write = writeContractMarker({
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
            contractJson: contract,
            canonicalVersion: 1,
          });
          await executeStatement(client, write.insert);

          const adapter = createPostgresAdapter();
          const driver = createPostgresDriverFromOptions({
            connect: { client },
            cursor: { disabled: true },
          });
          const runtime = createRuntime({
            contract,
            adapter,
            driver,
            verify: { mode: 'onFirstUse', requireMarker: true },
          });

          const tables = schema<Contract, CodecTypes>(contract).tables;
          const user = tables['user']!;
          const post = tables['post']!;
          const plan = sql<Contract, CodecTypes>({ contract, adapter })
            .from(user)
            .rightJoin(post, (on) => on.eqCol(user.columns['id']!, post.columns['userId']!))
            .select({
              userId: user.columns['id']!,
              email: user.columns['email']!,
              postId: post.columns['id']!,
              title: post.columns['title']!,
            })
            .build();

          type Row = ResultType<typeof plan>;
          const rows: Row[] = [];
          for await (const row of runtime.execute(plan)) {
            rows.push(row);
          }

          expect(rows.length).toBe(2);
          const firstPostRow = rows.find((r) => r.title === 'First Post');
          const orphanPostRow = rows.find((r) => r.title === 'Orphan Post');

          expect(firstPostRow).toBeDefined();
          expect(firstPostRow!.userId).not.toBeNull();
          expect(firstPostRow!.email).not.toBeNull();

          expect(orphanPostRow).toBeDefined();
          expect(orphanPostRow!.userId).toBeNull();
          expect(orphanPostRow!.email).toBeNull();

          expect(plan.meta.refs?.tables).toContain('user');
          expect(plan.meta.refs?.tables).toContain('post');

          await runtime.close();
        } finally {
          await client.end();
        }
      },
      { acceleratePort: 54050, databasePort: 54051, shadowDatabasePort: 54052 },
    );
  });

  it('FULL JOIN returns all users and posts', async () => {
    const outputDir = resolve(__dirname, '../.tmp-output');
    await execFileAsync('node', [
      cliPath,
      'emit',
      '--contract',
      contractTsPath,
      '--out',
      outputDir,
      '--adapter',
      adapterPath,
    ]);

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent);
    const contract = validateContract<Contract>(contractJson);

    await withDevDatabase(
      async ({ connectionString }) => {
        const client = new Client({ connectionString });
        await client.connect();
        try {
          await client.query('drop schema if exists prisma_contract cascade');
          await client.query('create schema if not exists public');
          await client.query('drop table if exists "comment"');
          await client.query('drop table if exists "post"');
          await client.query('drop table if exists "user"');
          await client.query('create table "user" (id serial primary key, email text not null)');
          await client.query(
            'create table "post" (id serial primary key, "userId" int4 not null, title text not null)',
          );
          await client.query('insert into "user" (email) values ($1), ($2)', [
            'ada@example.com',
            'tess@example.com',
          ]);
          await client.query('insert into "post" ("userId", title) values ($1, $2), ($3, $4)', [
            1,
            'First Post',
            999,
            'Orphan Post',
          ]);

          await executeStatement(client, ensureSchemaStatement);
          await executeStatement(client, ensureTableStatement);
          const write = writeContractMarker({
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
            contractJson: contract,
            canonicalVersion: 1,
          });
          await executeStatement(client, write.insert);

          const adapter = createPostgresAdapter();
          const driver = createPostgresDriverFromOptions({
            connect: { client },
            cursor: { disabled: true },
          });
          const runtime = createRuntime({
            contract,
            adapter,
            driver,
            verify: { mode: 'onFirstUse', requireMarker: true },
          });

          const tables = schema<Contract, CodecTypes>(contract).tables;
          const user = tables['user']!;
          const post = tables['post']!;
          const plan = sql<Contract, CodecTypes>({ contract, adapter })
            .from(user)
            .fullJoin(post, (on) => on.eqCol(user.columns['id']!, post.columns['userId']!))
            .select({
              userId: user.columns['id']!,
              email: user.columns['email']!,
              postId: post.columns['id']!,
              title: post.columns['title']!,
            })
            .build();

          type Row = ResultType<typeof plan>;
          const rows: Row[] = [];
          for await (const row of runtime.execute(plan)) {
            rows.push(row);
          }

          expect(rows.length).toBe(3);
          const adaRow = rows.find((r) => r.email === 'ada@example.com');
          const tessRow = rows.find((r) => r.email === 'tess@example.com');
          const orphanRow = rows.find((r) => r.title === 'Orphan Post');

          expect(adaRow).toBeDefined();
          expect(adaRow!.postId).not.toBeNull();

          expect(tessRow).toBeDefined();
          expect(tessRow!.postId).toBeNull();

          expect(orphanRow).toBeDefined();
          expect(orphanRow!.userId).toBeNull();
          expect(orphanRow!.email).toBeNull();

          expect(plan.meta.refs?.tables).toContain('user');
          expect(plan.meta.refs?.tables).toContain('post');

          await runtime.close();
        } finally {
          await client.end();
        }
      },
      { acceleratePort: 54060, databasePort: 54061, shadowDatabasePort: 54062 },
    );
  });

  it('chained joins (user -> post -> comment) returns correct results', async () => {
    const outputDir = resolve(__dirname, '../.tmp-output');
    await execFileAsync('node', [
      cliPath,
      'emit',
      '--contract',
      contractTsPath,
      '--out',
      outputDir,
      '--adapter',
      adapterPath,
    ]);

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
    const contractJson = JSON.parse(contractJsonContent);
    const contract = validateContract<Contract>(contractJson);

    await withDevDatabase(
      async ({ connectionString }) => {
        const client = new Client({ connectionString });
        await client.connect();
        try {
          await client.query('drop schema if exists prisma_contract cascade');
          await client.query('create schema if not exists public');
          await client.query('drop table if exists "comment"');
          await client.query('drop table if exists "post"');
          await client.query('drop table if exists "user"');
          await client.query('create table "user" (id serial primary key, email text not null)');
          await client.query(
            'create table "post" (id serial primary key, "userId" int4 not null, title text not null)',
          );
          await client.query(
            'create table "comment" (id serial primary key, "postId" int4 not null, content text not null)',
          );
          await client.query('insert into "user" (email) values ($1), ($2)', [
            'ada@example.com',
            'tess@example.com',
          ]);
          await client.query('insert into "post" ("userId", title) values ($1, $2), ($1, $3)', [
            1,
            'First Post',
            'Second Post',
          ]);
          await client.query(
            'insert into "comment" ("postId", content) values ($1, $2), ($1, $3)',
            [1, 'First Comment', 'Second Comment'],
          );

          await executeStatement(client, ensureSchemaStatement);
          await executeStatement(client, ensureTableStatement);
          const write = writeContractMarker({
            coreHash: contract.coreHash,
            profileHash: contract.profileHash ?? contract.coreHash,
            contractJson: contract,
            canonicalVersion: 1,
          });
          await executeStatement(client, write.insert);

          const adapter = createPostgresAdapter();
          const driver = createPostgresDriverFromOptions({
            connect: { client },
            cursor: { disabled: true },
          });
          const runtime = createRuntime({
            contract,
            adapter,
            driver,
            verify: { mode: 'onFirstUse', requireMarker: true },
          });

          const tables = schema<Contract, CodecTypes>(contract).tables;
          const user = tables['user']!;
          const post = tables['post']!;
          const comment = tables['comment']!;
          const plan = sql<Contract, CodecTypes>({ contract, adapter })
            .from(user)
            .innerJoin(post, (on) => on.eqCol(user.columns['id']!, post.columns['userId']!))
            .leftJoin(comment, (on) => on.eqCol(post.columns['id']!, comment.columns['postId']!))
            .select({
              userId: user.columns['id']!,
              email: user.columns['email']!,
              postId: post.columns['id']!,
              title: post.columns['title']!,
              commentId: comment.columns['id']!,
              content: comment.columns['content']!,
            })
            .build();

          expect(plan.ast?.joins).toBeDefined();
          expect(plan.ast?.joins?.length).toBe(2);
          expect(plan.ast?.joins?.[0]?.joinType).toBe('inner');
          expect(plan.ast?.joins?.[0]?.table.name).toBe('post');
          expect(plan.ast?.joins?.[1]?.joinType).toBe('left');
          expect(plan.ast?.joins?.[1]?.table.name).toBe('comment');

          type Row = ResultType<typeof plan>;
          const rows: Row[] = [];
          for await (const row of runtime.execute(plan)) {
            rows.push(row);
          }

          expect(rows.length).toBe(3);
          const firstPostRow = rows.find((r) => r.title === 'First Post' && r.commentId !== null);
          const secondPostRow = rows.find((r) => r.title === 'Second Post');

          expect(firstPostRow).toBeDefined();
          expect(firstPostRow!.commentId).not.toBeNull();
          expect(firstPostRow!.content).not.toBeNull();

          expect(secondPostRow).toBeDefined();
          expect(secondPostRow!.commentId).toBeNull();
          expect(secondPostRow!.content).toBeNull();

          expect(plan.meta.refs?.tables).toContain('user');
          expect(plan.meta.refs?.tables).toContain('post');
          expect(plan.meta.refs?.tables).toContain('comment');
          expect(plan.meta.refs?.columns).toEqual(
            expect.arrayContaining([
              { table: 'user', column: 'id' },
              { table: 'post', column: 'userId' },
              { table: 'post', column: 'id' },
              { table: 'comment', column: 'postId' },
            ]),
          );

          await runtime.close();
        } finally {
          await client.end();
        }
      },
      { acceleratePort: 54070, databasePort: 54071, shadowDatabasePort: 54072 },
    );
  });
});
