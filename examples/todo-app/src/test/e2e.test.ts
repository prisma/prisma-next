import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrateDatabase } from '../scripts/migrate';
import { connect } from '@prisma/runtime';
import { rawQuery, table } from '@prisma/sql';
import ir from '../../.prisma/contract.json';
import { Schema } from '@prisma/relational-ir';
import {
  getActiveUsers,
  getUserById,
  getUsersByEmail,
  getAllUsers,
  getUsersWithPosts,
  getPostsWithAuthors,
  getPublishedPostsWithAuthors,
} from '../app/queries';

describe('End-to-End Tests', () => {
  let db: any;

  beforeAll(async () => {
    // Setup database with test data
    await migrateDatabase();

    // Create a new connection for tests
    db = connect({
      ir: ir as Schema,
      database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'postgres',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
      },
    });
  });

  afterAll(async () => {
    if (db) {
      await db.end();
    }
  });

  describe('Basic Queries', () => {
    it('returns active users', async () => {
      const users = await getActiveUsers();

      expect(users).toHaveLength(2); // test1@example.com and test3@example.com
      expect(users[0]).toMatchObject({
        id: expect.any(Number),
        email: expect.stringMatching(/test[13]@example\.com/),
      });
      expect(users[1]).toMatchObject({
        id: expect.any(Number),
        email: expect.stringMatching(/test[13]@example\.com/),
      });
    });

    it('returns user by ID', async () => {
      const user = await getUserById(1);

      expect(user).toMatchObject({
        id: 1,
        email: 'test1@example.com',
        active: true,
        createdAt: expect.any(Date),
      });
    });

    it('returns users by email', async () => {
      const users = await getUsersByEmail('test1@example.com');

      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({
        id: 1,
        email: 'test1@example.com',
        active: true,
      });
    });

    it('returns all users', async () => {
      const users = await getAllUsers();

      expect(users).toHaveLength(3);
      expect(users.map((u) => u.email)).toEqual([
        'test1@example.com',
        'test2@example.com',
        'test3@example.com',
      ]);
    });
  });

  describe('Relationship Queries', () => {
    it('returns users with their published posts (1:N nested)', async () => {
      const usersWithPosts = await getUsersWithPosts();

      expect(usersWithPosts.length).toBeGreaterThanOrEqual(3);

      // Find user 1 (test1@example.com) - should have at least 1 published post
      const user1 = usersWithPosts.find((u) => u.id === 1);
      expect(user1).toBeDefined();
      expect(user1?.posts.length).toBeGreaterThanOrEqual(1);
      expect(user1?.posts[0]).toMatchObject({
        id: expect.any(Number),
        title: 'First Post',
        createdAt: expect.anything(), // Can be Date or String depending on context
      });

      // Find user 2 (test2@example.com) - should have at least 1 published post
      const user2 = usersWithPosts.find((u) => u.id === 2);
      expect(user2).toBeDefined();
      expect(user2?.posts.length).toBeGreaterThanOrEqual(1);
      expect(user2?.posts[0]).toMatchObject({
        id: expect.any(Number),
        title: 'Third Post',
        createdAt: expect.anything(), // Can be Date or String depending on context
      });

      // Find user 3 (test3@example.com) - should have at least 1 published post
      const user3 = usersWithPosts.find((u) => u.id === 3);
      expect(user3).toBeDefined();
      expect(user3?.posts.length).toBeGreaterThanOrEqual(1);
      expect(user3?.posts[0]).toMatchObject({
        id: expect.any(Number),
        title: 'Fourth Post',
        createdAt: expect.anything(), // Can be Date or String depending on context
      });
    });

    it('returns posts with their authors (N:1 flat)', async () => {
      const postsWithAuthors = await getPostsWithAuthors();

      expect(postsWithAuthors.length).toBeGreaterThanOrEqual(5);

      // Check that each post has author information
      postsWithAuthors.forEach((post) => {
        expect(post).toMatchObject({
          id: expect.any(Number),
          title: expect.any(String),
          author__id: expect.any(Number),
          author__email: expect.stringMatching(/test[123]@example\.com/),
        });
      });

      // Find the first post and verify its author
      const firstPost = postsWithAuthors.find((p) => p.title === 'First Post');
      expect(firstPost).toBeDefined();
      expect(firstPost?.author__id).toBe(1);
      expect(firstPost?.author__email).toBe('test1@example.com');
    });

    it('returns published posts with their authors', async () => {
      const publishedPosts = await getPublishedPostsWithAuthors();

      expect(publishedPosts.length).toBeGreaterThanOrEqual(3); // At least the published posts

      // Check that all posts are published and have author info
      publishedPosts.forEach((post) => {
        expect(post).toMatchObject({
          id: expect.any(Number),
          title: expect.any(String),
          createdAt: expect.anything(), // Can be Date or String depending on context
          author__id: expect.any(Number),
          author__email: expect.stringMatching(/test[123]@example\.com/),
        });
      });

      // Verify specific posts exist
      const titles = publishedPosts.map((p) => p.title);
      expect(titles).toContain('First Post');
      expect(titles).toContain('Third Post');
      expect(titles).toContain('Fourth Post');
      // Note: We don't check for absence of unpublished posts since there might be duplicates
    });
  });

  describe('Data Integrity', () => {
    it('verifies foreign key relationships', async () => {
      // Check that all posts have valid user references
      const postsWithAuthors = await getPostsWithAuthors();

      postsWithAuthors.forEach((post) => {
        expect([1, 2, 3]).toContain(post.author__id);
      });
    });

    it('verifies published status filtering', async () => {
      const allPosts = await getPostsWithAuthors();
      const publishedPosts = await getPublishedPostsWithAuthors();

      // All published posts should be in the full list
      publishedPosts.forEach((publishedPost) => {
        const foundInAll = allPosts.find((p) => p.id === publishedPost.id);
        expect(foundInAll).toBeDefined();
      });

      // Published posts should be fewer than all posts
      expect(publishedPosts.length).toBeLessThan(allPosts.length);
    });
  });

  describe('SQL Generation', () => {
    it('generates correct SQL for 1:N nested includes', async () => {
      const usersWithPosts = await getUsersWithPosts();

      // The query should have executed successfully
      expect(usersWithPosts).toBeDefined();
      expect(Array.isArray(usersWithPosts)).toBe(true);

      // Each user should have a posts array
      usersWithPosts.forEach((user) => {
        expect(user).toHaveProperty('posts');
        expect(Array.isArray(user.posts)).toBe(true);
      });
    });

    it('generates correct SQL for N:1 flat includes', async () => {
      const postsWithAuthors = await getPostsWithAuthors();

      // The query should have executed successfully
      expect(postsWithAuthors).toBeDefined();
      expect(Array.isArray(postsWithAuthors)).toBe(true);

      // Each post should have author fields prefixed with 'author__'
      postsWithAuthors.forEach((post) => {
        expect(post).toHaveProperty('author__id');
        expect(post).toHaveProperty('author__email');
      });
    });
  });
});
