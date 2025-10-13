import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parse } from '@prisma/psl';
import { emitContractAndTypes } from '@prisma/schema-emitter';
import { connect, createRuntime, verification } from '@prisma/runtime';
import { sql, TABLE_NAME } from '@prisma/sql';
import { t } from '../app/schema';
import { parseIR } from '@prisma/relational-ir';

describe('Integration Tests', () => {
  let db: any;
  let runtime: any;
  let postgresProcess: any;
  let contractIR: ReturnType<typeof parseIR>;

  beforeAll(async () => {
    // Start PostgreSQL using @prisma/dev
    postgresProcess = spawn('pnpx', ['@prisma/dev', 'postgres'], {
      stdio: 'pipe',
      env: { ...process.env, POSTGRES_PASSWORD: 'postgres' },
    });

    // Wait for PostgreSQL to be ready
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Generate schema files
    const pslContent = readFileSync('schema.psl', 'utf-8');
    const ast = parse(pslContent);
    const { contract, contractTypes } = await emitContractAndTypes(ast);

    // Ensure .prisma directory exists
    try {
      mkdirSync('.prisma', { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Write contract files
    writeFileSync('.prisma/contract.json', contract);
    writeFileSync('.prisma/contract.d.ts', contractTypes);

    // Connect to database without verification first
    contractIR = parseIR(contract);
    db = connect({
      ir: contractIR,
      database: {
        host: 'localhost',
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        password: 'postgres',
      },
    });

    // Create tables
    console.log('Creating tables...');
    await db.execute({
      type: 'raw',
      sql: `
        CREATE TABLE IF NOT EXISTS "user" (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          active BOOLEAN DEFAULT true,
          "createdAt" TIMESTAMP DEFAULT NOW()
        );
      `,
    });

    // Drop and recreate post table to ensure correct structure
    await db.execute({
      type: 'raw',
      sql: 'DROP TABLE IF EXISTS "post";',
    });

    await db.execute({
      type: 'raw',
      sql: `
        CREATE TABLE "post" (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          published BOOLEAN DEFAULT false,
          "createdAt" TIMESTAMP DEFAULT NOW(),
          user_id INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES "user"(id)
        );
      `,
    });

    // Check if tables were created
    console.log('Checking table structure...');
    const userTableCheck = await db.execute({
      type: 'raw',
      sql: "SELECT column_name FROM information_schema.columns WHERE table_name = 'user' ORDER BY ordinal_position;",
    });
    console.log(
      'User table columns:',
      userTableCheck.map((r: any) => r.column_name),
    );

    const postTableCheck = await db.execute({
      type: 'raw',
      sql: "SELECT column_name FROM information_schema.columns WHERE table_name = 'post' ORDER BY ordinal_position;",
    });
    console.log(
      'Post table columns:',
      postTableCheck.map((r: any) => r.column_name),
    );

    // Now create runtime with verification enabled
    runtime = createRuntime({
      ir: contractIR,
      driver: db,
      plugins: [verification({ mode: 'onFirstUse' })],
    });

    // Clear existing data and insert test data
    await db.execute({
      type: 'raw',
      sql: `DELETE FROM "user";`,
    });

    // Reset the sequence to start from 1
    await db.execute({
      type: 'raw',
      sql: `ALTER SEQUENCE "user_id_seq" RESTART WITH 1;`,
    });

    await db.execute({
      type: 'raw',
      sql: `
        INSERT INTO "user" (email, active, "createdAt") VALUES
        ('test1@example.com', true, NOW()),
        ('test2@example.com', false, NOW()),
        ('test3@example.com', true, NOW());
      `,
    });
  });

  afterAll(async () => {
    if (db) {
      await db.end();
    }
    if (postgresProcess) {
      postgresProcess.kill();
    }
  });

  it('executes getActiveUsers query with correct type inference', async () => {
    const query = sql(contractIR)
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email });

    console.log('Debug - t.user:', t.user);
    console.log('Debug - t.user[TABLE_NAME]:', t.user[TABLE_NAME]);
    console.log('Debug - Generated SQL:', query.build().sql);
    console.log('Debug - Parameters:', query.build().params);

    const results = await runtime.execute(query.build());

    // Type should be inferred as Array<{ id: number; email: string }>
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('email');
    expect(typeof results[0].id).toBe('number');
    expect(typeof results[0].email).toBe('string');

    // Verify correct data
    const emails = results.map((r: any) => r.email);
    expect(emails).toContain('test1@example.com');
    expect(emails).toContain('test3@example.com');
    expect(emails).not.toContain('test2@example.com');
  });

  it('executes getUserById query', async () => {
    const query = sql(contractIR).from(t.user).where(t.user.id.eq(1)).select({
      id: t.user.id,
      email: t.user.email,
      active: t.user.active,
      createdAt: t.user.createdAt,
    });

    const results = await runtime.execute(query.build());

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
    expect(results[0].email).toBe('test1@example.com');
    expect(results[0].active).toBe(true);
    expect(results[0].createdAt).toBeInstanceOf(Date);
  });

  it('executes getUsersByEmail query', async () => {
    const query = sql(contractIR)
      .from(t.user)
      .where(t.user.email.eq('test2@example.com'))
      .select({ id: t.user.id, email: t.user.email, active: t.user.active });

    const results = await runtime.execute(query.build());

    expect(results).toHaveLength(1);
    expect(results[0].email).toBe('test2@example.com');
    expect(results[0].active).toBe(false);
  });

  it('handles queries with LIMIT', async () => {
    const query = sql(contractIR)
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email })
      .limit(2);

    const results = await runtime.execute(query.build());

    expect(results).toHaveLength(2);
  });

  it('handles queries with ORDER BY', async () => {
    const query = sql(contractIR)
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('id', 'ASC');

    const results = await runtime.execute(query.build());

    expect(results).toHaveLength(3);
    expect(results[0].id).toBeLessThan(results[1].id);
    expect(results[1].id).toBeLessThan(results[2].id);
  });

  it('throws error for unknown table', async () => {
    const query = sql(contractIR)
      .from('nonexistent' as any)
      .select({ id: t.user.id });

    await expect(runtime.execute(query.build())).rejects.toThrow();
  });

  it('throws error for invalid ORDER BY field', async () => {
    const query = sql(contractIR)
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('nonexistent', 'ASC');

    await expect(runtime.execute(query.build())).rejects.toThrow();
  });

  it('demonstrates proper type inference with FromBuilder::select()', async () => {
    // Test 1: Single field selection with proper type inference
    const singleFieldQuery = sql(contractIR)
      .from(t.user)
      .where(t.user.id.eq(1))
      .select({ email: t.user.email });

    const singleFieldResults = await runtime.execute(singleFieldQuery.build());

    // TypeScript should infer this as Array<{ email: string }>
    expect(singleFieldResults).toHaveLength(1);
    expect(singleFieldResults[0]).toHaveProperty('email');
    expect(typeof singleFieldResults[0].email).toBe('string');
    expect(singleFieldResults[0].email).toBe('test1@example.com');

    // Should NOT have other properties
    expect(singleFieldResults[0]).not.toHaveProperty('id');
    expect(singleFieldResults[0]).not.toHaveProperty('active');

    // Test 2: Multiple field selection with proper type inference
    const multiFieldQuery = sql(contractIR).from(t.user).where(t.user.active.eq(true)).select({
      id: t.user.id,
      email: t.user.email,
      active: t.user.active,
    });

    const multiFieldResults = await runtime.execute(multiFieldQuery.build());

    // TypeScript should infer this as Array<{ id: number; email: string; active: boolean }>
    expect(multiFieldResults).toHaveLength(2);

    // Verify each result has the correct shape and types
    multiFieldResults.forEach((result: any) => {
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('email');
      expect(result).toHaveProperty('active');

      expect(typeof result.id).toBe('number');
      expect(typeof result.email).toBe('string');
      expect(typeof result.active).toBe('boolean');

      expect(result.active).toBe(true);
    });

    // Test 3: Method chaining preserves type information
    const chainedQuery = sql(contractIR)
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('id', 'ASC')
      .limit(1);

    const chainedResults = await runtime.execute(chainedQuery.build());

    // Type should still be Array<{ id: number; email: string }> after chaining
    expect(chainedResults).toHaveLength(1);
    expect(chainedResults[0]).toHaveProperty('id');
    expect(chainedResults[0]).toHaveProperty('email');
    expect(typeof chainedResults[0].id).toBe('number');
    expect(typeof chainedResults[0].email).toBe('string');

    // Should be the first user (lowest ID)
    expect(chainedResults[0].id).toBe(1);
    expect(chainedResults[0].email).toBe('test1@example.com');
  });

  it('demonstrates type safety with different select shapes', async () => {
    // Test different select shapes to ensure type inference works correctly

    // Shape 1: Only ID
    const idOnlyQuery = sql(contractIR)
      .from(t.user)
      .where(t.user.id.eq(2))
      .select({ id: t.user.id });

    const idOnlyResults = await runtime.execute(idOnlyQuery.build());
    expect(idOnlyResults).toHaveLength(1);
    expect(idOnlyResults[0]).toEqual({ id: 2 });
    expect(Object.keys(idOnlyResults[0])).toEqual(['id']);

    // Shape 2: Only email
    const emailOnlyQuery = sql(contractIR)
      .from(t.user)
      .where(t.user.id.eq(3))
      .select({ email: t.user.email });

    const emailOnlyResults = await runtime.execute(emailOnlyQuery.build());
    expect(emailOnlyResults).toHaveLength(1);
    expect(emailOnlyResults[0]).toEqual({ email: 'test3@example.com' });
    expect(Object.keys(emailOnlyResults[0])).toEqual(['email']);

    // Shape 3: All fields
    const allFieldsQuery = sql(contractIR).from(t.user).where(t.user.id.eq(1)).select({
      id: t.user.id,
      email: t.user.email,
      active: t.user.active,
      createdAt: t.user.createdAt,
    });

    const allFieldsResults = await runtime.execute(allFieldsQuery.build());
    expect(allFieldsResults).toHaveLength(1);
    expect(allFieldsResults[0]).toHaveProperty('id');
    expect(allFieldsResults[0]).toHaveProperty('email');
    expect(allFieldsResults[0]).toHaveProperty('active');
    expect(allFieldsResults[0]).toHaveProperty('createdAt');

    // Verify types
    expect(typeof allFieldsResults[0].id).toBe('number');
    expect(typeof allFieldsResults[0].email).toBe('string');
    expect(typeof allFieldsResults[0].active).toBe('boolean');
    expect(allFieldsResults[0].createdAt).toBeInstanceOf(Date);
  });

  it('demonstrates aliased select fields work correctly', async () => {
    // Test aliased select fields to ensure they work with contract hash verification
    // and produce the correct SQL with AS clauses

    const aliasedQuery = sql(contractIR).from(t.user).where(t.user.id.eq(1)).select({
      userId: t.user.id,
      userEmail: t.user.email,
      isActive: t.user.active,
      createdAt: t.user.createdAt,
    });

    const aliasedPlan = aliasedQuery.build();

    // Verify the SQL contains proper AS clauses
    expect(aliasedPlan.sql).toContain('"id" AS "userId"');
    expect(aliasedPlan.sql).toContain('"email" AS "userEmail"');
    expect(aliasedPlan.sql).toContain('"active" AS "isActive"');
    expect(aliasedPlan.sql).toContain('"createdAt" AS "createdAt"');

    const aliasedResults = await runtime.execute(aliasedPlan);

    // Verify results have aliased property names
    expect(aliasedResults).toHaveLength(1);
    expect(aliasedResults[0]).toHaveProperty('userId');
    expect(aliasedResults[0]).toHaveProperty('userEmail');
    expect(aliasedResults[0]).toHaveProperty('isActive');
    expect(aliasedResults[0]).toHaveProperty('createdAt');

    // Verify types are correct
    expect(typeof aliasedResults[0].userId).toBe('number');
    expect(typeof aliasedResults[0].userEmail).toBe('string');
    expect(typeof aliasedResults[0].isActive).toBe('boolean');
    expect(aliasedResults[0].createdAt).toBeInstanceOf(Date);

    // Verify values are correct
    expect(aliasedResults[0].userId).toBe(1);
    expect(aliasedResults[0].userEmail).toBe('test1@example.com');
    expect(aliasedResults[0].isActive).toBe(true);

    // Should NOT have original property names
    expect(aliasedResults[0]).not.toHaveProperty('id');
    expect(aliasedResults[0]).not.toHaveProperty('email');
    expect(aliasedResults[0]).not.toHaveProperty('active');
  });

  it('demonstrates mixed aliased and non-aliased select fields', async () => {
    // Test mixing aliased and non-aliased fields
    const mixedQuery = sql(contractIR).from(t.user).where(t.user.id.eq(2)).select({
      id: t.user.id, // No alias
      userEmail: t.user.email, // Aliased
      active: t.user.active, // No alias
      createdAt: t.user.createdAt, // No alias
    });

    const mixedPlan = mixedQuery.build();

    // Verify SQL contains both aliased and non-aliased fields
    expect(mixedPlan.sql).toContain('"id" AS "id"');
    expect(mixedPlan.sql).toContain('"email" AS "userEmail"');
    expect(mixedPlan.sql).toContain('"active" AS "active"');
    expect(mixedPlan.sql).toContain('"createdAt" AS "createdAt"');

    const mixedResults = await runtime.execute(mixedPlan);

    // Verify results have correct property names
    expect(mixedResults).toHaveLength(1);
    expect(mixedResults[0]).toHaveProperty('id');
    expect(mixedResults[0]).toHaveProperty('userEmail');
    expect(mixedResults[0]).toHaveProperty('active');
    expect(mixedResults[0]).toHaveProperty('createdAt');

    // Verify values
    expect(mixedResults[0].id).toBe(2);
    expect(mixedResults[0].userEmail).toBe('test2@example.com');
    expect(mixedResults[0].active).toBe(false);
  });
});
