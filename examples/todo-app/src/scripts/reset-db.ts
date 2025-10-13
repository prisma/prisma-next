/**
 * Database Reset Script
 *
 * Safely resets the database to an empty state by dropping all tables
 * and clearing the contract state. This is useful for testing migrations
 * on a fresh database.
 */

import { connectAdmin } from '@prisma/migrate';

export async function resetDatabase() {
  console.log('🔄 Resetting database to empty state...\n');

  const connectionString = `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'postgres'}`;
  const admin = await connectAdmin(connectionString);

  try {
    await admin.withAdvisoryLock('prisma:reset', async () => {
      // Drop all tables and schemas
      await admin.executeScript({
        type: 'script',
        statements: [
          {
            type: 'raw',
            template: [
              {
                kind: 'text',
                value:
                  'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS prisma_contract CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;',
              },
            ],
            intent: 'ddl',
          },
        ],
      });
    });

    console.log('✅ Database reset to empty state');
    console.log('   - Dropped all tables and schemas');
    console.log('   - Cleared contract state');
    console.log('   - Ready for fresh migration');
  } catch (error) {
    console.error('❌ Database reset failed:', (error as Error).message);
    throw error;
  } finally {
    await admin.close();
  }
}

// Run reset if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  resetDatabase().catch(console.error);
}
