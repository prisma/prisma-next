/**
 * Database Setup Script
 *
 * Creates the prisma_contract.version table and seeds it with the current contract hash.
 * This script emulates database migrations/provisioning.
 */

import { connect } from '@prisma/runtime';
import ir from '../.prisma/contract.json' assert { type: 'json' };
import { Schema } from '@prisma/relational-ir';

export async function setupDatabase() {
  console.log('🔧 Setting up database with contract version table...\n');

  // Connect to database
  const db = connect({
    ir: ir as Schema,
    verify: 'never', // Skip verification during setup
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'postgres',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    },
  });

  try {
    // Create prisma_contract schema
    await db.execute({
      type: 'raw',
      sql: 'CREATE SCHEMA IF NOT EXISTS prisma_contract;',
    });
    console.log('✅ Created prisma_contract schema');

    // Create version table
    await db.execute({
      type: 'raw',
      sql: `
        CREATE TABLE IF NOT EXISTS prisma_contract.version (
          id    int PRIMARY KEY,
          hash  text NOT NULL
        );
      `,
    });
    console.log('✅ Created prisma_contract.version table');

    // Create user table (from our schema)
    await db.execute({
      type: 'raw',
      sql: `
        CREATE TABLE IF NOT EXISTS "user" (
          id        SERIAL PRIMARY KEY,
          email     VARCHAR(255) UNIQUE NOT NULL,
          active    BOOLEAN DEFAULT true,
          "createdAt" TIMESTAMP DEFAULT NOW()
        );
      `,
    });
    console.log('✅ Created user table');

    // Seed or update contract hash
    const contractHash = ir.contractHash;
    if (!contractHash) {
      throw new Error('No contract hash found in schema.json');
    }

    await db.execute({
      type: 'raw',
      sql: `
        INSERT INTO prisma_contract.version (id, hash)
        VALUES (1, $1)
        ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash;
      `,
      params: [contractHash],
    });
    console.log(`✅ Seeded contract hash: ${contractHash}`);

    // Insert some test data
    await db.execute({
      type: 'raw',
      sql: `
        INSERT INTO "user" (email, active, "createdAt") VALUES
        ('alice@example.com', true, NOW()),
        ('bob@example.com', false, NOW()),
        ('charlie@example.com', true, NOW())
        ON CONFLICT (email) DO NOTHING;
      `,
    });
    console.log('✅ Inserted test data');

    console.log('\n🎉 Database setup complete!');
    return db;
  } catch (error) {
    console.error('❌ Database setup failed:', (error as Error).message);
    throw error;
  } finally {
    await db.end();
  }
}

// Run setup if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDatabase().catch(console.error);
}
