import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../_fixtures/composites-object-create/generated/contract';
import contractJson from '../../_fixtures/composites-object-create/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withMongoPort } from '../../_harness/mongo';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/composites/object/create.ts
// (mongodb matrix entry). Upstream tests two schema variants via a test matrix:
//   - contentProperty === 'required' → content: CommentContent (non-null)
//   - contentProperty === 'optional' → content: CommentContent? (nullable)
//
// This port uses two separate roots in one contract:
//   - db.comments_required  → required content
//   - db.comments_optional  → optional content
//
// Upstream tests:
//   - set              → PORTED (both variants)
//   - set shorthand    → PORTED (both variants)
//   - set null         → PORTED (optional variant only; required is a compile-time concern)
//   - set null shorthand → PORTED (optional variant only)
//   - set nested list  → PORTED (both variants)
//
// Note: upstream "set null" for the required variant throws a runtime error;
// in prisma-next the required constraint is enforced at compile time by the type
// system (content cannot be null/undefined on CommentRequired), so that branch
// has no runtime equivalent and is not ported.
//
// Note: create() returns the input data merged with the server-assigned _id
// (an ObjectId, not the decoded hex string); the type-level string comes from
// re-reads via all()/first().

function withComposites(fn: Parameters<typeof withMongoPort<Contract>>[1]) {
  return withMongoPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/composites/object/create', () => {
  describe('required content', () => {
    it(
      'set',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_required.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ vote: true, userId: '10' }],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ userId: '10', vote: true }],
            },
          });
          expect(comment._id).toBeInstanceOf(ObjectId);
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set shorthand (same as set for ORM — no prisma set wrapper)',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_required.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ vote: true, userId: '10' }],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ userId: '10', vote: true }],
            },
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set nested list',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_required.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [
                { userId: '10', vote: true },
                { userId: '11', vote: true },
              ],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [
                { userId: '10', vote: true },
                { userId: '11', vote: true },
              ],
            },
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );
  });

  describe('optional content', () => {
    it(
      'set',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_optional.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ vote: true, userId: '10' }],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ userId: '10', vote: true }],
            },
          });
          expect(comment._id).toBeInstanceOf(ObjectId);
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set shorthand (same as set for ORM — no prisma set wrapper)',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_optional.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ vote: true, userId: '10' }],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [{ userId: '10', vote: true }],
            },
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set null',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_optional.create({
            country: 'France',
            content: null,
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: null,
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set null shorthand (content omitted)',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_optional.create({
            country: 'France',
          });

          expect(comment.country).toBe('France');
          expect(comment.content === null || comment.content === undefined).toBe(true);
        }),
      timeouts.spinUpMongoMemoryServer,
    );

    it(
      'set nested list',
      () =>
        withComposites(async ({ db }) => {
          const comment = await db.comments_optional.create({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [
                { userId: '10', vote: true },
                { userId: '11', vote: true },
              ],
            },
          });

          expect(comment).toMatchObject({
            country: 'France',
            content: {
              text: 'Hello World',
              upvotes: [
                { userId: '10', vote: true },
                { userId: '11', vote: true },
              ],
            },
          });
        }),
      timeouts.spinUpMongoMemoryServer,
    );
  });
});
