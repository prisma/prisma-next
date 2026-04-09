import { createServer, type ServerResponse } from 'node:http';
import type { SimplifyDeep } from '@prisma-next/mongo-orm';
import { acc, fn } from '@prisma-next/mongo-pipeline-builder';
import { MongoCountStage, MongoLimitStage, MongoSortStage } from '@prisma-next/mongo-query-ast';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from './db';
import { createClient } from './db';

const PORT = 3456;
const DB_NAME = 'blog';

async function seed(orm: Db['orm']) {
  const createdUsers = await orm.users.createAll([
    {
      name: 'Alice Chen',
      email: 'alice@example.com',
      bio: 'Full-stack engineer and tech blogger',
      address: { street: '123 Main St', city: 'San Francisco', zip: '94102', country: 'US' },
    },
    {
      name: 'Bob Kumar',
      email: 'bob@example.com',
      bio: 'DevOps enthusiast',
      address: { street: '456 Oak Ave', city: 'Portland', zip: null, country: 'US' },
    },
    { name: 'Carol Santos', email: 'carol@example.com', bio: null, address: null },
  ]);
  const alice = createdUsers[0];
  const bob = createdUsers[1];
  const carol = createdUsers[2];
  if (!alice || !bob || !carol) throw new Error('Failed to seed users');

  const articles = orm.posts.variant('Article');
  const tutorials = orm.posts.variant('Tutorial');

  await articles.createAll([
    {
      title: 'Getting Started with Prisma Next',
      content: 'Learn how to build contract-first data access layers with Prisma Next and MongoDB.',
      summary: 'A comprehensive introduction to contract-first data layers.',
      authorId: alice._id as string,
      createdAt: new Date('2026-01-15'),
    },
    {
      title: 'Contract-First Development',
      content:
        'Why contract-first architecture leads to better type safety and developer experience.',
      summary: 'The benefits of contract-first over code-first approaches.',
      authorId: alice._id as string,
      createdAt: new Date('2026-02-01'),
    },
  ]);

  await tutorials.createAll([
    {
      title: 'Build a REST API with Prisma Next',
      content: 'Step-by-step tutorial for building a REST API with Prisma Next and MongoDB.',
      difficulty: 'intermediate',
      duration: 45,
      authorId: bob._id as string,
      createdAt: new Date('2026-02-20'),
    },
    {
      title: 'Advanced Query Patterns',
      content: 'Deep dive into advanced query patterns for MongoDB.',
      difficulty: 'advanced',
      duration: 90,
      authorId: carol._id as string,
      createdAt: new Date('2026-03-10'),
    },
  ]);
}

// ---------------------------------------------------------------------------
// ORM queries
// ---------------------------------------------------------------------------

export async function getPosts(orm: Db['orm']) {
  return orm.posts.include('author').all();
}

export async function getArticles(orm: Db['orm']) {
  return orm.posts.variant('Article').all();
}

export async function getTutorials(orm: Db['orm']) {
  return orm.posts.variant('Tutorial').all();
}

export async function getUsers(orm: Db['orm']) {
  return orm.users.all();
}

export type PostsResponse = SimplifyDeep<Awaited<ReturnType<typeof getPosts>>>;
export type ArticlesResponse = SimplifyDeep<Awaited<ReturnType<typeof getArticles>>>;
export type TutorialsResponse = SimplifyDeep<Awaited<ReturnType<typeof getTutorials>>>;
export type UsersResponse = SimplifyDeep<Awaited<ReturnType<typeof getUsers>>>;

// ---------------------------------------------------------------------------
// Pipeline DSL queries — type-safe aggregation pipelines
// ---------------------------------------------------------------------------

export async function getAuthorLeaderboard(pipeline: Db['pipeline'], runtime: Db['runtime']) {
  const plan = pipeline
    .from('posts')
    .group((f) => ({
      _id: f.authorId,
      postCount: acc.count(),
      latestPost: acc.max(f.createdAt),
    }))
    .sort({ postCount: -1 })
    .lookup({
      from: 'users',
      localField: '_id',
      foreignField: '_id',
      as: 'author',
    })
    .build();

  return runtime.execute(plan);
}

export async function getRecentPostSummaries(pipeline: Db['pipeline'], runtime: Db['runtime']) {
  const plan = pipeline
    .from('posts')
    .sort({ createdAt: -1 })
    .limit(3)
    .addFields((f) => ({
      titleUpper: fn.toUpper(f.title),
    }))
    .project('title', 'titleUpper', 'authorId', 'createdAt')
    .build();

  return runtime.execute(plan);
}

export async function getPostsWithAuthors(pipeline: Db['pipeline'], runtime: Db['runtime']) {
  const plan = pipeline
    .from('posts')
    .lookup({
      from: 'users',
      localField: 'authorId',
      foreignField: '_id',
      as: 'authorInfo',
    })
    .sort({ createdAt: -1 })
    .build();

  return runtime.execute(plan);
}

export async function getDashboard(pipeline: Db['pipeline'], runtime: Db['runtime']) {
  const plan = pipeline
    .from('posts')
    .facet({
      totalPosts: [new MongoCountStage('count')],
      recentPosts: [new MongoSortStage({ createdAt: -1 }), new MongoLimitStage(2)],
      postsByAuthor: [new MongoSortStage({ authorId: 1 })],
    })
    .build();

  return runtime.execute(plan);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function jsonResponse(res: ServerResponse, data: unknown, status = 200) {
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

  const { orm, runtime, pipeline } = await createClient(uri, DB_NAME);

  console.log('Seeding data...');
  await seed(orm);
  console.log('Seed complete.');

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/api/posts') {
        jsonResponse(res, await getPosts(orm));
      } else if (req.method === 'GET' && req.url === '/api/posts/articles') {
        jsonResponse(res, await getArticles(orm));
      } else if (req.method === 'GET' && req.url === '/api/posts/tutorials') {
        jsonResponse(res, await getTutorials(orm));
      } else if (req.method === 'GET' && req.url === '/api/users') {
        jsonResponse(res, await getUsers(orm));
      } else if (req.method === 'GET' && req.url === '/api/pipeline/leaderboard') {
        jsonResponse(res, await getAuthorLeaderboard(pipeline, runtime));
      } else if (req.method === 'GET' && req.url === '/api/pipeline/recent') {
        jsonResponse(res, await getRecentPostSummaries(pipeline, runtime));
      } else if (req.method === 'GET' && req.url === '/api/pipeline/posts-with-authors') {
        jsonResponse(res, await getPostsWithAuthors(pipeline, runtime));
      } else if (req.method === 'GET' && req.url === '/api/pipeline/dashboard') {
        jsonResponse(res, await getDashboard(pipeline, runtime));
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
    console.log(`  GET http://localhost:${PORT}/api/posts/articles   (variant: Article)`);
    console.log(`  GET http://localhost:${PORT}/api/posts/tutorials  (variant: Tutorial)`);
    console.log(`  GET http://localhost:${PORT}/api/users`);
    console.log('Pipeline DSL endpoints:');
    console.log(`  GET http://localhost:${PORT}/api/pipeline/leaderboard`);
    console.log(`  GET http://localhost:${PORT}/api/pipeline/recent`);
    console.log(`  GET http://localhost:${PORT}/api/pipeline/posts-with-authors`);
    console.log(`  GET http://localhost:${PORT}/api/pipeline/dashboard`);
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
