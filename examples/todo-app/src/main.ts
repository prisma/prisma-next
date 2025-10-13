import { parse } from '@prisma/psl';
import { emitSchemaAndTypes } from '@prisma/schema-emitter';
import { readFileSync, writeFileSync } from 'fs';
import { getActiveUsers, getUserById, getUsersByEmail } from './queries';
import { db } from './db';
import { assertContract, verifyContract } from '@prisma/runtime';
import ir from '../.prisma/schema.json' assert { type: 'json' };
import { parseIR } from '@prisma/relational-ir';

async function main() {
  console.log('🚀 PSL → IR Prototype Demo\n');

  // Step 1: Parse PSL schema
  console.log('1. Parsing PSL schema...');
  const pslContent = readFileSync('schema.psl', 'utf-8');
  const ast = parse(pslContent);
  console.log('✅ PSL parsed successfully\n');

  // Step 2: Emit IR and TypeScript types
  console.log('2. Emitting IR and TypeScript types...');
  const { schema, types } = await emitSchemaAndTypes(ast);

  // Write schema.json
  writeFileSync('.prisma/schema.json', schema);
  console.log('✅ schema.json generated');

  // Write schema.d.ts
  writeFileSync('.prisma/schema.d.ts', types);
  console.log('✅ schema.d.ts generated\n');

  // Step 3: Contract verification (one line!)
  console.log('3. Verifying contract...');
  const ir = parseIR(schema);
  await assertContract({ expectedHash: ir.contractHash!, client: db.pool });
  console.log('✅ Contract verified\n');

  // Step 4: Execute type-safe queries
  console.log('4. Executing type-safe queries...');

  try {
    // Get active users
    const activeUsers = await getActiveUsers();
    console.log('Active users:', activeUsers);

    // Get user by ID
    const user = await getUserById(1);
    console.log('User by ID 1:', user);

    // Get users by email
    const usersByEmail = await getUsersByEmail('alice@example.com');
    console.log('Users by email:', usersByEmail);

    console.log('\n✅ All queries executed successfully!');
  } catch (error) {
    console.error('❌ Database error:', (error as Error).message);
    console.log('\nNote: Make sure PostgreSQL is running and the database exists.');
    console.log(
      'You can start PostgreSQL with: docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15',
    );
  } finally {
    await db.end();
  }
}

main().catch(console.error);
