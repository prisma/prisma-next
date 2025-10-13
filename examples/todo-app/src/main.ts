import { parse } from '@prisma/psl';
import { emitContractAndTypes } from '@prisma/schema-emitter';
import { readFileSync, writeFileSync } from 'fs';
import {
  getActiveUsers,
  getUserById,
  getUsersByEmail,
  getUsersWithPosts,
  getPostsWithAuthors,
  getPublishedPostsWithAuthors,
} from './queries.js';
import { db } from './db.js';
import { assertContract } from '@prisma/runtime';
import { parseIR } from '@prisma/relational-ir';

async function main() {
  console.log('🚀 PSL → Data Contract Prototype Demo\n');

  // Step 1: Parse PSL
  console.log('1. Parsing PSL...');
  const pslContent = readFileSync('schema.psl', 'utf-8');
  const ast = parse(pslContent);
  console.log('✅ PSL parsed successfully\n');

  // Step 2: Emit data contract and TypeScript types
  console.log('2. Emitting data contract and TypeScript types...');
  const { contract: contractJson, contractTypes } = await emitContractAndTypes(ast);

  // Write contract.json
  writeFileSync('.prisma/contract.json', contractJson);
  console.log('✅ contract.json generated');

  // Write contract.d.ts
  writeFileSync('.prisma/contract.d.ts', contractTypes);
  console.log('✅ contract.d.ts generated\n');

  // Step 3: Contract verification (one line!)
  console.log('3. Verifying data contract...');
  const contractIR = parseIR(contractJson);
  await assertContract({ expectedHash: contractIR.contractHash!, client: db.pool });
  console.log('✅ Data contract verified\n');

  // Step 4: Execute type-safe queries
  console.log('4. Executing type-safe queries...');

  try {
    // Basic queries
    console.log('\n--- Basic Queries ---');
    const activeUsers = await getActiveUsers();
    console.log('Active users:', activeUsers);

    const user = await getUserById(1);
    console.log('User by ID 1:', user);

    const usersByEmail = await getUsersByEmail('alice@example.com');
    console.log('Users by email:', usersByEmail);

    // Relationship queries
    console.log('\n--- Relationship Queries ---');
    const usersWithPosts = await getUsersWithPosts();
    console.log('Users with posts:', usersWithPosts);

    const postsWithAuthors = await getPostsWithAuthors();
    console.log('Posts with authors:', postsWithAuthors);

    const publishedPostsWithAuthors = await getPublishedPostsWithAuthors();
    console.log('Published posts with authors:', publishedPostsWithAuthors);

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
