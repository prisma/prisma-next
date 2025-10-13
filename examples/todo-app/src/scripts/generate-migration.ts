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
import { readdir } from 'fs/promises';

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
      // Find the latest migration that matches the current contract hash
      const migrationsDir = join(process.cwd(), 'migrations');
      const entries = await readdir(migrationsDir, { withFileTypes: true });
      const migrationDirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

      let foundContract = null;
      for (const dir of migrationDirs.reverse()) {
        // Check newest first
        try {
          const metaPath = join(migrationsDir, dir, 'meta.json');
          const metaContent = await fs.readFile(metaPath, 'utf-8');
          const meta = JSON.parse(metaContent);

          if (meta.to.kind === 'contract' && meta.to.hash === contractResult.hash) {
            // Found the migration that created this state, use its target contract
            const opsetPath = join(migrationsDir, dir, 'opset.json');
            const opsetContent = await fs.readFile(opsetPath, 'utf-8');
            const opset = JSON.parse(opsetContent);

            // Reconstruct contract from opset (simplified - in real implementation would be more robust)
            foundContract = reconstructContractFromOpset(opset, contractResult.hash);
            break;
          }
        } catch (error) {
          // Skip invalid migrations
          continue;
        }
      }

      if (foundContract) {
        // Use the actual contract hash from the database, not the reconstructed one
        contractA = {
          target: 'postgres',
          contractHash: contractResult.hash,
          tables: foundContract.tables,
        };
        console.log(
          `   Current state: contract ${contractResult.hash} (reconstructed from migration)`,
        );
      } else {
        // If we can't find a matching migration, we need to treat this as a contract mismatch
        // This means the database has a contract hash that doesn't match any known migration
        throw new Error(
          `Database contract hash ${contractResult.hash} does not match any known migration. ` +
            `This suggests the database is in an inconsistent state. ` +
            `Consider resetting the database or applying the correct migration.`,
        );
      }
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

/**
 * Reconstruct a contract from an opset (simplified implementation)
 * In a real implementation, this would be more robust and handle all operation types
 */
function reconstructContractFromOpset(opset: any, contractHash: string): any {
  const tables: any = {};

  for (const op of opset.operations) {
    if (op.kind === 'addTable') {
      const columns: any = {};
      const primaryKey = { kind: 'primaryKey' as const, columns: [] as string[] };
      const uniques: any[] = [];
      const foreignKeys: any[] = [];

      // Process columns
      for (const col of op.columns) {
        columns[col.name] = {
          type: col.type,
          nullable: col.nullable,
          default: col.default,
        };
      }

      // Process constraints
      if (op.constraints) {
        for (const constraint of op.constraints) {
          switch (constraint.kind) {
            case 'primaryKey':
              primaryKey.columns = constraint.columns;
              break;
            case 'unique':
              uniques.push({
                kind: 'unique',
                columns: constraint.columns,
              });
              break;
            case 'foreignKey':
              foreignKeys.push({
                kind: 'foreignKey',
                columns: constraint.columns,
                references: constraint.ref,
              });
              break;
          }
        }
      }

      tables[op.name] = {
        columns,
        primaryKey: primaryKey.columns.length > 0 ? primaryKey : undefined,
        uniques: uniques.length > 0 ? uniques : undefined,
        foreignKeys: foreignKeys.length > 0 ? foreignKeys : undefined,
        indexes: [], // Simplified - would need to track indexes separately
      };
    }
  }

  return {
    target: 'postgres',
    contractHash: contractHash, // Use the provided contract hash
    tables,
  };
}

// Run generation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const migrationId = process.argv[2]; // Optional custom ID
  generateMigration(migrationId).catch(console.error);
}
