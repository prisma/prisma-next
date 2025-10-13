/**
 * Schema Evolution Script
 *
 * Demonstrates the migration planner by making a small change to the PSL schema
 * and generating a new migration. This shows the full workflow in action.
 */

import { join } from 'path';
import { promises as fs } from 'fs';
import { generateMigration } from './generate-migration';

export async function evolveSchema() {
  console.log('🔄 Schema Evolution Demo\n');

  // Read current schema
  const schemaPath = join(process.cwd(), 'schema.psl');
  const originalSchema = await fs.readFile(schemaPath, 'utf-8');

  console.log('📝 Current schema:');
  console.log(originalSchema);

  // Make a small change: add a "bio" column to the User model
  const modifiedSchema = originalSchema.replace(
    /model User \{([^}]+)\}/,
    `model User {
  id        Int        @id @default(autoincrement())
  email     String     @unique
  active    Boolean    @default(true)
  bio       String   @default("")
  createdAt DateTime   @default(now())

  posts     Post[]
}`,
  );

  console.log('\n📝 Modified schema:');
  console.log(modifiedSchema);

  // Write the modified schema
  await fs.writeFile(schemaPath, modifiedSchema);
  console.log('\n✅ Schema updated');

  // Generate migration
  console.log('\n🔧 Generating migration...');
  await generateMigration();

  console.log('\n🎉 Schema evolution complete!');
  console.log('💡 Next steps:');
  console.log('   1. Run "pnpm migrate" to apply the migration');
  console.log('   2. Check the database to see the new "bio" column');
  console.log('   3. Run "pnpm reset" to start over');
}

// Run evolution if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  evolveSchema().catch(console.error);
}
