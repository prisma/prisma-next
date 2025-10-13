/**
 * Migration Script
 *
 * Uses the migration runner system to apply migration programs.
 * This script loads and applies migration programs to bring the database
 * schema in sync with the current contract.
 */

import { connect } from '@prisma/runtime';
import { rawQuery, value, table } from '@prisma/sql';
import { loadProgram, applyNext, connectAdmin, pgLowerer, nextApplicable } from '@prisma/migrate';
import ir from '../../.prisma/contract.json';
import { Schema } from '@prisma/relational-ir';
import { join } from 'path';
import { promises as fs } from 'fs';
import { readdir } from 'fs/promises';

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
    // Find all migration directories
    const migrationsDir = join(process.cwd(), 'migrations');
    const entries = await readdir(migrationsDir, { withFileTypes: true });
    const migrationDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name + '/')
      .sort();

    console.log(`📁 Found ${migrationDirs.length} migration(s): ${migrationDirs.join(', ')}`);

    // Load all migration programs
    const programs = [];
    for (const dir of migrationDirs.sort()) {
      const program = await loadProgram(join(migrationsDir, dir));
      programs.push(program);
      console.log(`📦 Loaded: ${program.meta.id}`);
    }

    // Apply migrations until none are applicable
    const lowerer = pgLowerer();
    let appliedCount = 0;

    while (true) {
      const contractResult = await admin.readContract();
      const contractMarker = { hash: contractResult.hash };
      const nextProgram = nextApplicable(programs, contractMarker);

      if (!nextProgram) {
        console.log('✅ No more applicable migrations');
        break;
      }

      console.log(`\n🔄 Applying migration: ${nextProgram.meta.id}`);
      console.log(
        `   From: ${nextProgram.meta.from.kind === 'contract' ? nextProgram.meta.from.hash : nextProgram.meta.from.kind}`,
      );
      console.log(`   To: ${nextProgram.meta.to.hash}`);
      console.log(`   Operations: ${nextProgram.ops.operations.length}`);

      const report = await applyNext([nextProgram], admin, lowerer);

      if (report.applied) {
        console.log('✅ Applied migration successfully');
        console.log(`   Program ID: ${report.programId}`);
        console.log(`   SQL Hash: ${report.sqlHash}`);
        appliedCount++;
      } else {
        console.log('ℹ️  Migration not applicable');
        console.log(`   Reason: ${report.reason}`);
        break;
      }
    }

    console.log(`\n📊 Applied ${appliedCount} migration(s) total`);

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
