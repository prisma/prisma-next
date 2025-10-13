import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parse } from '@prisma/psl';
import { emitContractAndTypes } from '@prisma/schema-emitter';
import { connect } from '@prisma/runtime';
import { sql, TABLE_NAME } from '@prisma/sql';
import { t } from '../app/schema';
import { parseIR } from '@prisma/relational-ir';

describe('Integration Tests', () => {
  let db: any;
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

    // Connect to database
    contractIR = parseIR(contract);
    db = connect({
      ir: contractIR,
      verify: 'onFirstUse',
      database: {
        host: 'localhost',
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        password: 'postgres',
      },
    });

    // Create table
    console.log('Creating table...');
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

    // Check if table was created
    console.log('Checking table structure...');
    const tableCheck = await db.execute({
      type: 'raw',
      sql: "SELECT column_name FROM information_schema.columns WHERE table_name = 'user' ORDER BY ordinal_position;",
    });
    console.log(
      'Table columns:',
      tableCheck.map((r: any) => r.column_name),
    );

    // Insert test data
    await db.execute({
      type: 'raw',
      sql: `
        INSERT INTO "user" (email, active, "createdAt") VALUES
        ('test1@example.com', true, NOW()),
        ('test2@example.com', false, NOW()),
        ('test3@example.com', true, NOW())
        ON CONFLICT (email) DO NOTHING;
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

    const results = await db.execute(query.build());

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

    const results = await db.execute(query.build());

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

    const results = await db.execute(query.build());

    expect(results).toHaveLength(1);
    expect(results[0].email).toBe('test2@example.com');
    expect(results[0].active).toBe(false);
  });

  it('handles queries with LIMIT', async () => {
    const query = sql(contractIR)
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email })
      .limit(2);

    const results = await db.execute(query.build());

    expect(results).toHaveLength(2);
  });

  it('handles queries with ORDER BY', async () => {
    const query = sql(contractIR)
      .from(t.user)
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('id', 'ASC');

    const results = await db.execute(query.build());

    expect(results).toHaveLength(3);
    expect(results[0].id).toBeLessThan(results[1].id);
    expect(results[1].id).toBeLessThan(results[2].id);
  });

  it('throws error for unknown table', async () => {
    const query = sql(contractIR)
      .from('nonexistent' as any)
      .select({ id: t.user.id });

    await expect(db.execute(query.build())).rejects.toThrow();
  });

  it('throws error for invalid ORDER BY field', async () => {
    const query = sql(contractIR)
      .from(t.user)
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email })
      .orderBy('nonexistent', 'ASC');

    await expect(db.execute(query.build())).rejects.toThrow();
  });
});
