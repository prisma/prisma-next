/**
 * Debug Migration Script
 *
 * Debug why migrations aren't being applied
 */

import { connectAdmin, loadProgram, nextApplicable } from '@prisma/migrate';
import { join } from 'path';
import { readdir } from 'fs/promises';

export async function debugMigration() {
  console.log('🔍 Debugging migration application...\n');

  const connectionString = `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'postgres'}`;
  const admin = await connectAdmin(connectionString);

  try {
    // Check current database state
    const contractResult = await admin.readContract();
    console.log('📊 Current database state:');
    console.log(`   Contract hash: ${contractResult.hash || 'null (empty)'}`);

    const contractMarker = { hash: contractResult.hash };
    console.log(`   Contract marker: ${JSON.stringify(contractMarker)}`);

    // Load migration programs
    const migrationsDir = join(process.cwd(), 'migrations');
    const entries = await readdir(migrationsDir, { withFileTypes: true });
    const migrationDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name + '/')
      .sort();

    console.log(`\n📁 Found ${migrationDirs.length} migration(s): ${migrationDirs.join(', ')}`);

    const programs = [];
    for (const dir of migrationDirs) {
      const program = await loadProgram(join(migrationsDir, dir));
      programs.push(program);
      console.log(`📦 Loaded: ${program.meta.id}`);
      console.log(`   From: ${JSON.stringify(program.meta.from)}`);
      console.log(`   To: ${JSON.stringify(program.meta.to)}`);
    }

    // Test nextApplicable
    console.log('\n🧠 Testing nextApplicable...');
    const nextProgram = nextApplicable(programs, contractMarker);

    if (nextProgram) {
      console.log(`✅ Next applicable migration: ${nextProgram.meta.id}`);
    } else {
      console.log('❌ No applicable migrations found');

      // Debug why each migration is not applicable
      for (const program of programs) {
        console.log(`\n🔍 Checking migration: ${program.meta.id}`);
        console.log(`   From: ${JSON.stringify(program.meta.from)}`);
        console.log(`   To: ${JSON.stringify(program.meta.to)}`);
        console.log(`   Current marker: ${JSON.stringify(contractMarker)}`);

        // Check if from matches current state
        const fromMatches = JSON.stringify(program.meta.from) === JSON.stringify(contractMarker);
        console.log(`   From matches current: ${fromMatches}`);
      }
    }
  } catch (error) {
    console.error('❌ Debug failed:', (error as Error).message);
    throw error;
  } finally {
    await admin.close();
  }
}

// Run debug if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  debugMigration().catch(console.error);
}
