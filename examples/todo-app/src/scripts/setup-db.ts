/**
 * Database Setup Script
 *
 * Creates the prisma_contract.version table and seeds it with the current contract hash.
 * This script emulates database migrations/provisioning using the new DDL primitives.
 */

import { connect } from '@prisma/runtime';
import { rawQuery, value, table } from '@prisma/sql';
import { connectAdmin, ScriptAST } from '@prisma/migrate';
import ir from '../../.prisma/contract.json';
import { Schema } from '@prisma/relational-ir';

export async function setupDatabase() {
  console.log('🔧 Setting up database with contract version table...\n');

  // Connect to database
  const db = connect({
    ir: ir as Schema,
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'postgres',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    },
  });

  // Connect with admin privileges for DDL operations
  const connectionString = `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'postgres'}`;
  const admin = await connectAdmin(connectionString);

  try {
    // Build ScriptAST programmatically for table creation
    const setupScript: ScriptAST = {
      type: 'script',
      statements: [
        {
          type: 'tx',
          statements: [
            {
              type: 'createTable',
              name: { name: 'user' },
              columns: [
                { name: 'id', type: 'int4', nullable: false, default: { kind: 'autoincrement' } },
                { name: 'email', type: 'varchar', nullable: false },
                {
                  name: 'active',
                  type: 'bool',
                  nullable: false,
                  default: { kind: 'literal', value: 'true' },
                },
                { name: 'createdAt', type: 'timestamp', nullable: false, default: { kind: 'now' } },
              ],
              constraints: [
                { kind: 'primaryKey', columns: ['id'] },
                { kind: 'unique', columns: ['email'] },
              ],
              ifNotExists: true,
            },
            {
              type: 'createTable',
              name: { name: 'post' },
              columns: [
                { name: 'id', type: 'int4', nullable: false, default: { kind: 'autoincrement' } },
                { name: 'title', type: 'text', nullable: false },
                {
                  name: 'published',
                  type: 'bool',
                  nullable: false,
                  default: { kind: 'literal', value: 'false' },
                },
                { name: 'createdAt', type: 'timestamp', nullable: false, default: { kind: 'now' } },
                { name: 'user_id', type: 'int4', nullable: false },
              ],
              constraints: [
                { kind: 'primaryKey', columns: ['id'] },
                {
                  kind: 'foreignKey',
                  columns: ['user_id'],
                  ref: { table: 'user', columns: ['id'] },
                },
              ],
              ifNotExists: true,
            },
          ],
        },
      ],
    };

    // Execute DDL using AdminConnection
    await admin.executeScript(setupScript);
    console.log('✅ Created user and post tables using DDL primitives');

    // Clear existing test data first (keep using rawQuery for DML)
    await db.execute(rawQuery`
      DELETE FROM ${table('post')};
      DELETE FROM ${table('user')};
      ALTER SEQUENCE "user_id_seq" RESTART WITH 1;
      ALTER SEQUENCE "post_id_seq" RESTART WITH 1;
    `);
    console.log('✅ Cleared existing test data');

    // Insert some test data (keep using rawQuery for DML)
    await db.execute(rawQuery`
      INSERT INTO ${table('user')} (email, active, "createdAt") VALUES
      (${value('test1@example.com')}, ${value(true)}, NOW()),
      (${value('test2@example.com')}, ${value(false)}, NOW()),
      (${value('test3@example.com')}, ${value(true)}, NOW())
      ON CONFLICT (email) DO NOTHING;
    `);
    console.log('✅ Inserted test user data');

    // Insert some test post data
    await db.execute(rawQuery`
      INSERT INTO ${table('post')} (title, published, "createdAt", user_id) VALUES
      (${value('First Post')}, ${value(true)}, NOW(), 1),
      (${value('Second Post')}, ${value(false)}, NOW(), 1),
      (${value('Third Post')}, ${value(true)}, NOW(), 2),
      (${value('Fourth Post')}, ${value(true)}, NOW(), 3),
      (${value('Fifth Post')}, ${value(false)}, NOW(), 3)
      ON CONFLICT DO NOTHING;
    `);
    console.log('✅ Inserted test post data');

    console.log('\n🎉 Database setup complete!');
    console.log('✨ Used new DDL primitives for table creation');
    return db;
  } catch (error) {
    console.error('❌ Database setup failed:', (error as Error).message);
    throw error;
  } finally {
    await admin.close();
    await db.end();
  }
}

// Run setup if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDatabase().catch(console.error);
}
