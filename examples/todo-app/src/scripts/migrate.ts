/**
 * Migration Script
 *
 * Uses the migration runner system to apply migration programs.
 * This script loads and applies migration programs to bring the database
 * schema in sync with the current contract.
 */

import { connect } from '@prisma/runtime';
import { rawQuery, value, table } from '@prisma/sql';
import { loadProgram, applyNext, connectAdmin, pgLowerer } from '@prisma/migrate';
import ir from '../../.prisma/contract.json';
import { Schema } from '@prisma/relational-ir';
import { join } from 'path';

export async function migrateDatabase() {
  console.log('🔧 Running database migrations...\n');

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
    // Load the initial schema migration program
    const migrationDir = join(process.cwd(), 'migrations', '001_initial_schema');
    const program = await loadProgram(migrationDir);

    console.log(`📦 Loaded migration program: ${program.meta.id}`);
    console.log(`   From: ${program.meta.from.kind}`);
    console.log(`   To: ${program.meta.to.hash}`);
    console.log(`   Operations: ${program.ops.operations.length}`);

    // Apply the migration using the runner
    const lowerer = pgLowerer();
    const report = await applyNext([program], admin, lowerer);

    if (report.applied) {
      console.log('✅ Applied migration successfully');
      console.log(`   Program ID: ${report.programId}`);
      console.log(`   SQL Hash: ${report.sqlHash}`);
    } else {
      console.log('ℹ️  Migration not applicable');
      console.log(`   Reason: ${report.reason}`);
    }

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

    console.log('\n🎉 Database migration complete!');
    console.log('✨ Used migration runner for schema updates');
    return db;
  } catch (error) {
    console.error('❌ Database migration failed:', (error as Error).message);
    throw error;
  } finally {
    await admin.close();
    await db.end();
  }
}

// Run migration if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateDatabase().catch(console.error);
}
