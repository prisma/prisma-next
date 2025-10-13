/**
 * Database Setup Script
 *
 * Creates the prisma_contract.version table and seeds it with the current contract hash.
 * This script emulates database migrations/provisioning.
 */

import { connect } from '@prisma/runtime';
import { rawQuery, unsafe, value, table, column } from '@prisma/sql';
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

  try {
    // Create user table (from our schema)
    await db.execute(rawQuery`
      ${unsafe(`
        CREATE TABLE IF NOT EXISTS "user" (
          id        SERIAL PRIMARY KEY,
          email     VARCHAR(255) UNIQUE NOT NULL,
          active    BOOLEAN DEFAULT true,
          "createdAt" TIMESTAMP DEFAULT NOW()
        );
      `)}
    `);
    console.log('✅ Created user table');

    // Create post table (from our schema)
    await db.execute(rawQuery`
      ${unsafe(`
        CREATE TABLE IF NOT EXISTS "post" (
          id        SERIAL PRIMARY KEY,
          title     TEXT NOT NULL,
          published BOOLEAN DEFAULT false,
          "createdAt" TIMESTAMP DEFAULT NOW(),
          user_id   INTEGER NOT NULL REFERENCES "user"(id)
        );
      `)}
    `);
    console.log('✅ Created post table');

    // Clear existing test data first
    await db.execute(rawQuery`
      ${unsafe(`
        DELETE FROM "post";
        DELETE FROM "user";
        ALTER SEQUENCE "user_id_seq" RESTART WITH 1;
        ALTER SEQUENCE "post_id_seq" RESTART WITH 1;
      `)}
    `);
    console.log('✅ Cleared existing test data');

    // Insert some test data
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
