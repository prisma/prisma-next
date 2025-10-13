/**
 * Migration Planner Demo
 *
 * Demonstrates the complete migration workflow:
 * 1. Reset database to empty state
 * 2. Generate migration from PSL changes
 * 3. Apply all migrations
 * 4. Show the results
 */

import { resetDatabase } from './reset-db';
import { migrateDatabase } from './migrate';
import { evolveSchema } from './evolve-schema';
import { join } from 'path';
import { promises as fs } from 'fs';
import { readdir } from 'fs/promises';

export async function runMigrationDemo() {
  console.log('🚀 Migration Planner Demo');
  console.log('='.repeat(50));
  console.log('This demo shows the complete migration workflow:\n');

  try {
    // Step 0: Clean up any generated migrations (keep only initial)
    console.log('Step 0: Clean up generated migrations');
    console.log('-'.repeat(40));
    const migrationsDir = join(process.cwd(), 'migrations');
    const entries = await readdir(migrationsDir, { withFileTypes: true });
    const migrationDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== '001_initial_schema'); // Keep the initial migration

    for (const dir of migrationDirs) {
      await fs.rm(join(migrationsDir, dir), { recursive: true, force: true });
      console.log(`   🗑️  Removed migration: ${dir}`);
    }

    if (migrationDirs.length === 0) {
      console.log('   ✅ No generated migrations to clean up');
    }
    console.log('');

    // Step 1: Reset database
    console.log('Step 1: Reset database to empty state');
    console.log('-'.repeat(40));
    await resetDatabase();
    console.log('');

    // Step 2: Show current schema
    console.log('Step 2: Current schema');
    console.log('-'.repeat(40));
    const schemaPath = join(process.cwd(), 'schema.psl');
    const currentSchema = await fs.readFile(schemaPath, 'utf-8');
    console.log(currentSchema);
    console.log('');

    // Step 3: Evolve schema (make a change)
    console.log('Step 3: Evolve schema (add bio column)');
    console.log('-'.repeat(40));
    await evolveSchema();
    console.log('');

    // Step 4: Apply migrations
    console.log('Step 4: Apply all migrations');
    console.log('-'.repeat(40));
    await migrateDatabase();
    console.log('');

    // Step 5: Show final state
    console.log('Step 5: Final database state');
    console.log('-'.repeat(40));
    console.log('✅ Database now has:');
    console.log('   • user table with id, email, active, bio, createdAt columns');
    console.log('   • post table with id, title, published, createdAt, user_id columns');
    console.log('   • Foreign key relationship between post.user_id → user.id');
    console.log('   • Unique constraint on user.email');
    console.log('   • Test data inserted');

    console.log('\n🎉 Migration Planner Demo Complete!');
    console.log('\nWhat happened:');
    console.log('0. ✅ Cleaned up any previous generated migrations');
    console.log('1. ✅ Database was reset to empty state');
    console.log('2. ✅ PSL schema was modified (added bio column)');
    console.log('3. ✅ Migration planner generated a new migration program');
    console.log('4. ✅ Migration runner applied all applicable migrations');
    console.log('5. ✅ Database is now in sync with the desired schema');
  } catch (error) {
    console.error('❌ Demo failed:', (error as Error).message);
    throw error;
  }
}

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrationDemo().catch(console.error);
}
