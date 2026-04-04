import { createServer } from 'node:http';
import type { SimplifyDeep } from '@prisma-next/mongo-orm';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from './db';
import { createClient } from './db';

const PORT = 3456;
const DB_NAME = 'blog';

async function seed(orm: Db['orm']) {
  const [alice, bob, carol] = await orm.users.createAll([
    { name: 'Alice Chen', email: 'alice@example.com', bio: 'Full-stack engineer and tech blogger' },
    { name: 'Bob Kumar', email: 'bob@example.com', bio: 'DevOps enthusiast' },
    { name: 'Carol Santos', email: 'carol@example.com', bio: null },
  ]);

  await orm.posts.createAll([
    {
      title: 'Getting Started with Prisma Next',
      content: 'Learn how to build contract-first data access layers with Prisma Next and MongoDB.',
      authorId: alice._id as string,
      createdAt: new Date('2026-01-15'),
    },
    {
      title: 'Contract-First Development',
      content:
        'Why contract-first architecture leads to better type safety and developer experience.',
      authorId: alice._id as string,
      createdAt: new Date('2026-02-01'),
    },
    {
      title: 'MongoDB Best Practices',
      content: 'Tips and tricks for designing efficient MongoDB schemas.',
      authorId: bob._id as string,
      createdAt: new Date('2026-02-20'),
    },
    {
      title: 'The Future of ORMs',
      content: 'How modern ORMs are evolving to support multiple database paradigms.',
      authorId: carol._id as string,
      createdAt: new Date('2026-03-10'),
    },
  ]);
}

export async function getPosts(orm: Db['orm']) {
  return orm.posts.include('author').all();
}

export async function getUsers(orm: Db['orm']) {
  return orm.users.all();
}

export type PostsResponse = SimplifyDeep<Awaited<ReturnType<typeof getPosts>>>;
export type UsersResponse = SimplifyDeep<Awaited<ReturnType<typeof getUsers>>>;

function jsonResponse(res: import('node:http').ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function main() {
  console.log('Starting in-memory MongoDB...');
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replSet.getUri();
  console.log(`MongoDB ready at ${uri}`);

  const { orm, runtime } = await createClient(uri, DB_NAME);

  console.log('Seeding data...');
  await seed(orm);
  console.log('Seed complete.');

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/api/posts') {
        const posts = await getPosts(orm);
        jsonResponse(res, posts);
      } else if (req.method === 'GET' && req.url === '/api/users') {
        const users = await getUsers(orm);
        jsonResponse(res, users);
      } else {
        jsonResponse(res, { error: 'Not found' }, 404);
      }
    } catch (err) {
      console.error('Request error:', err);
      jsonResponse(res, { error: 'Internal server error' }, 500);
    }
  });

  server.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log(`  GET http://localhost:${PORT}/api/posts`);
    console.log(`  GET http://localhost:${PORT}/api/users`);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    server.close();
    await runtime.close();
    await replSet.stop();
    process.exit(0);
  });
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
