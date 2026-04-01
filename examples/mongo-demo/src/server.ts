import { createServer } from 'node:http';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createDb } from './db';

const PORT = 3456;
const DB_NAME = 'blog';

async function seed(client: MongoClient) {
  const db = client.db(DB_NAME);

  const alice = new ObjectId().toHexString();
  const bob = new ObjectId().toHexString();
  const carol = new ObjectId().toHexString();

  await db.collection('users').insertMany([
    {
      _id: alice as never,
      name: 'Alice Chen',
      email: 'alice@example.com',
      bio: 'Full-stack engineer and tech blogger',
    },
    { _id: bob as never, name: 'Bob Kumar', email: 'bob@example.com', bio: 'DevOps enthusiast' },
    { _id: carol as never, name: 'Carol Santos', email: 'carol@example.com', bio: null },
  ]);

  await db.collection('posts').insertMany([
    {
      title: 'Getting Started with Prisma Next',
      content: 'Learn how to build contract-first data access layers with Prisma Next and MongoDB.',
      authorId: alice,
      createdAt: new Date('2026-01-15'),
    },
    {
      title: 'Contract-First Development',
      content:
        'Why contract-first architecture leads to better type safety and developer experience.',
      authorId: alice,
      createdAt: new Date('2026-02-01'),
    },
    {
      title: 'MongoDB Best Practices',
      content: 'Tips and tricks for designing efficient MongoDB schemas.',
      authorId: bob,
      createdAt: new Date('2026-02-20'),
    },
    {
      title: 'The Future of ORMs',
      content: 'How modern ORMs are evolving to support multiple database paradigms.',
      authorId: carol,
      createdAt: new Date('2026-03-10'),
    },
  ]);
}

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

  const client = new MongoClient(uri);
  await client.connect();

  console.log('Seeding data...');
  await seed(client);
  console.log('Seed complete.');

  const { orm } = await createDb(uri, DB_NAME);

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/api/posts') {
        const posts = await orm.posts.findMany({ include: { author: true } });
        jsonResponse(res, posts);
      } else if (req.method === 'GET' && req.url === '/api/users') {
        const users = await orm.users.findMany();
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
    await client.close();
    await replSet.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
