/**
 * Generate Migration Script
 *
 * Uses the migration planner to generate a new migration from PSL changes.
 * This script compares the current database state with the desired PSL state
 * and creates a migration program.
 */

import { connectAdmin } from '@prisma/migrate';
import { planMigration } from '@prisma/migrate';
import { emitContractAndTypes } from '@prisma/schema-emitter';
import { parse } from '@prisma/psl';
import { join } from 'path';
import { promises as fs } from 'fs';

export async function generateMigration(migrationId?: string) {
  console.log('🔧 Generating new migration...\n');

  const connectionString = `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'postgres'}`;
  const admin = await connectAdmin(connectionString);

  try {
    // Step 1: Get current database contract state
    console.log('📊 Reading current database state...');
    const contractResult = await admin.readContract();

    let contractA;
    if (!contractResult.hash) {
      contractA = { kind: 'empty' as const };
      console.log('   Current state: empty database');
    } else {
      // For MVP, we'll treat any existing state as empty to keep it simple
      // In a real implementation, this would reconstruct the contract from the database
      contractA = { kind: 'empty' as const };
      console.log('   Current state: treating as empty for MVP demo');
    }

    // Step 2: Parse and emit desired PSL state
    console.log('📝 Parsing PSL schema...');
    const pslContent = await fs.readFile(join(process.cwd(), 'schema.psl'), 'utf-8');
    const schemaAst = parse(pslContent);
    const { contract } = await emitContractAndTypes(schemaAst);
    const contractB = JSON.parse(contract);

    console.log(`   Target contract hash: ${contractB.contractHash}`);
    console.log(`   Tables: ${Object.keys(contractB.tables).join(', ')}`);

    // Step 3: Plan the migration
    console.log('\n🧠 Planning migration...');
    const plan = await planMigration(contractA, contractB, { id: migrationId });

    console.log(`✅ Migration planned: ${plan.meta.id}`);
    console.log(`   Operations: ${plan.opset.operations.length}`);
    console.log(`   OpSet Hash: ${plan.opSetHash}`);

    // Step 4: Write migration program to disk
    const migrationDir = join(process.cwd(), 'migrations', plan.meta.id);
    await fs.mkdir(migrationDir, { recursive: true });

    await fs.writeFile(join(migrationDir, 'meta.json'), JSON.stringify(plan.meta, null, 2));

    await fs.writeFile(join(migrationDir, 'opset.json'), JSON.stringify(plan.opset, null, 2));

    await fs.writeFile(join(migrationDir, 'diff.json'), JSON.stringify(plan.diffJson, null, 2));

    await fs.writeFile(join(migrationDir, 'notes.md'), plan.notesMd);

    console.log(`\n📦 Migration program created:`);
    console.log(`   Directory: ${migrationDir}`);
    console.log(`   Files: meta.json, opset.json, diff.json, notes.md`);

    console.log('\n📋 Migration Summary:');
    const { summary } = plan.diffJson;
    if (summary.tablesAdded > 0) console.log(`   • ${summary.tablesAdded} table(s) added`);
    if (summary.columnsAdded > 0) console.log(`   • ${summary.columnsAdded} column(s) added`);
    if (summary.uniquesAdded > 0)
      console.log(`   • ${summary.uniquesAdded} unique constraint(s) added`);
    if (summary.indexesAdded > 0) console.log(`   • ${summary.indexesAdded} index(es) added`);
    if (summary.fksAdded > 0) console.log(`   • ${summary.fksAdded} foreign key(s) added`);

    console.log('\n🎉 Migration generation complete!');
    console.log('💡 Run "pnpm migrate" to apply the new migration');

    return plan;
  } catch (error) {
    console.error('❌ Migration generation failed:', (error as Error).message);
    throw error;
  } finally {
    await admin.close();
  }
}

// Run generation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const migrationId = process.argv[2]; // Optional custom ID
  generateMigration(migrationId).catch(console.error);
}
