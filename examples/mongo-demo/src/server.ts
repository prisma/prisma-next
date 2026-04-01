import { createServer } from 'node:http';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createDb } from './db';

const PORT = 3456;
const DB_NAME = 'task_tracker';

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
      addresses: [
        { street: '123 Main St', city: 'San Francisco', zip: '94102' },
        { street: '456 Market St', city: 'San Francisco', zip: '94105' },
      ],
    },
    {
      _id: bob as never,
      name: 'Bob Kumar',
      email: 'bob@example.com',
      addresses: [{ street: '789 Oak Ave', city: 'Portland', zip: '97201' }],
    },
    {
      _id: carol as never,
      name: 'Carol Santos',
      email: 'carol@example.com',
      addresses: [],
    },
  ]);

  await db.collection('tasks').insertMany([
    {
      title: 'Login form crashes on empty password',
      type: 'bug',
      severity: 'critical',
      assigneeId: alice,
      comments: [
        {
          _id: new ObjectId().toHexString(),
          text: 'Reproduces on Chrome and Firefox',
          createdAt: new Date('2026-03-15'),
        },
        {
          _id: new ObjectId().toHexString(),
          text: 'Root cause: missing null check in auth middleware',
          createdAt: new Date('2026-03-16'),
        },
      ],
    },
    {
      title: 'Dashboard chart renders wrong axis labels',
      type: 'bug',
      severity: 'medium',
      assigneeId: bob,
      comments: [
        {
          _id: new ObjectId().toHexString(),
          text: 'Only affects bar charts, line charts are fine',
          createdAt: new Date('2026-03-20'),
        },
      ],
    },
    {
      title: 'Dark mode support',
      type: 'feature',
      priority: 'high',
      targetRelease: 'v2.1',
      assigneeId: alice,
      comments: [
        {
          _id: new ObjectId().toHexString(),
          text: 'Design mockups attached to the ticket',
          createdAt: new Date('2026-03-10'),
        },
        {
          _id: new ObjectId().toHexString(),
          text: 'Should we support system preference detection?',
          createdAt: new Date('2026-03-11'),
        },
        {
          _id: new ObjectId().toHexString(),
          text: "Yes, let's auto-detect and allow manual override",
          createdAt: new Date('2026-03-12'),
        },
      ],
    },
    {
      title: 'Export to CSV',
      type: 'feature',
      priority: 'medium',
      targetRelease: 'v2.2',
      assigneeId: carol,
      comments: [],
    },
    {
      title: 'Memory leak in websocket handler',
      type: 'bug',
      severity: 'critical',
      assigneeId: bob,
      comments: [
        {
          _id: new ObjectId().toHexString(),
          text: 'Heap grows ~50MB/hour under load',
          createdAt: new Date('2026-03-25'),
        },
      ],
    },
    {
      title: 'Multi-language support',
      type: 'feature',
      priority: 'low',
      targetRelease: 'v3.0',
      assigneeId: carol,
      comments: [
        {
          _id: new ObjectId().toHexString(),
          text: 'Start with i18n framework integration',
          createdAt: new Date('2026-03-28'),
        },
      ],
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
      if (req.method === 'GET' && req.url === '/api/tasks') {
        const tasks = await orm.tasks.findMany({ include: { assignee: true } });
        jsonResponse(res, tasks);
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
    console.log(`  GET http://localhost:${PORT}/api/tasks`);
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
