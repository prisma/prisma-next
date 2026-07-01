import type { Contract } from '@prisma-next/contract/types';
import { crossRef } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateSqlContractFully } from '@prisma-next/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  createTestSqlNamespace,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
} as const;

function interpret(schema: string) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  return interpretPslDocumentToSqlContract({ ...baseInput, ...document });
}

function relationsOf(contract: Contract) {
  return modelsOf(contract) as Record<string, { relations?: Record<string, unknown> }>;
}

describe('interpretPslDocumentToSqlContract explicit through: many-to-many', () => {
  it('lowers an explicit through: end to the same N:M contract as the bare-list form', () => {
    const explicit = interpret(`model Post {
  id Int @id
  tags Tag[] @relation(through: PostTag)
}

model Tag {
  id Int @id
  posts Post[]
}

model PostTag {
  postId Int
  tagId Int
  post Post @relation(from: [postId], to: [id])
  tag Tag @relation(from: [tagId], to: [id])

  @@id([postId, tagId])
}
`);
    const bare = interpret(`model Post {
  id Int @id
  tags Tag[]
}

model Tag {
  id Int @id
  posts Post[]
}

model PostTag {
  postId Int
  tagId Int
  post Post @relation(from: [postId], to: [id])
  tag Tag @relation(from: [tagId], to: [id])

  @@id([postId, tagId])
}
`);

    expect(explicit.ok).toBe(true);
    expect(bare.ok).toBe(true);
    if (!explicit.ok || !bare.ok) return;
    expect(explicit.value).toEqual(bare.value);

    const envelope = JSON.parse(JSON.stringify(explicit.value)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });

  it('resolves both ends when through: is declared on one and the inverse is bare', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[] @relation(through: PostTag)
}

model Tag {
  id Int @id
  posts Post[]
}

model PostTag {
  postId Int
  tagId Int
  post Post @relation(from: [postId], to: [id])
  tag Tag @relation(from: [tagId], to: [id])

  @@id([postId, tagId])
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['Post']?.relations).toEqual({
      tags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['postId'] },
        through: {
          table: 'postTag',
          namespaceId: 'public',
          parentColumns: ['postId'],
          childColumns: ['tagId'],
          targetColumns: ['id'],
        },
      },
    });
    expect(models['Tag']?.relations).toEqual({
      posts: {
        to: crossRef('Post', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['tagId'] },
        through: {
          table: 'postTag',
          namespaceId: 'public',
          parentColumns: ['tagId'],
          childColumns: ['postId'],
          targetColumns: ['id'],
        },
      },
    });
  });

  it('selects the named junction when two junctions link the same pair of models', () => {
    const explicit = interpret(`model User {
  id Int @id
  ownedTags Tag[] @relation(through: TagOwnership)
  watchedTags Tag[] @relation(through: TagWatch)
}

model Tag {
  id Int @id
  owners User[] @relation(through: TagOwnership)
  watchers User[] @relation(through: TagWatch)
}

model TagOwnership {
  userId Int
  tagId Int
  user User @relation(from: [userId], to: [id])
  tag Tag @relation(from: [tagId], to: [id])

  @@id([userId, tagId])
}

model TagWatch {
  userId Int
  tagId Int
  user User @relation(from: [userId], to: [id])
  tag Tag @relation(from: [tagId], to: [id])

  @@id([userId, tagId])
}
`);

    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;

    const models = relationsOf(explicit.value);
    expect(models['User']?.relations).toEqual({
      ownedTags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['userId'] },
        through: {
          table: 'tagOwnership',
          namespaceId: 'public',
          parentColumns: ['userId'],
          childColumns: ['tagId'],
          targetColumns: ['id'],
        },
      },
      watchedTags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['userId'] },
        through: {
          table: 'tagWatch',
          namespaceId: 'public',
          parentColumns: ['userId'],
          childColumns: ['tagId'],
          targetColumns: ['id'],
        },
      },
    });
  });

  it('emits the junction near-miss diagnostic when through: names a non-junction model', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[] @relation(through: PostTag)
}

model Tag {
  id Int @id
}

model PostTag {
  id Int @id
  postId Int
  tagId Int
  post Post @relation(from: [postId], to: [id])
  tag Tag @relation(from: [tagId], to: [id])
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_JUNCTION_ID_NOT_FK_COVERING',
          message: expect.stringContaining('Post.tags'),
        }),
      ]),
    );
    const diagnostic = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_JUNCTION_ID_NOT_FK_COVERING',
    );
    expect(diagnostic?.message).toContain('PostTag');
    expect(diagnostic?.message).toContain('@@id');
  });

  it('defers a self-relation through: to the ambiguity diagnostic rather than silently picking', () => {
    const result = interpret(`model User {
  id Int @id
  follows User[] @relation(through: Follow)
}

model Follow {
  followerId Int
  followeeId Int
  follower User @relation(from: [followerId], to: [id])
  followee User @relation(from: [followeeId], to: [id])

  @@id([followerId, followeeId])
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_AMBIGUOUS_BACKRELATION_LIST',
          message: expect.stringContaining('User.follows'),
        }),
      ]),
    );
  });
});

const selfRelationFollowJunction = `model Follow {
  followerId Int
  followeeId Int
  follower User @relation(from: followerId)
  followee User @relation(from: followeeId)

  @@id([followerId, followeeId])
}
`;

describe('interpretPslDocumentToSqlContract qualified through: disambiguation', () => {
  it('pins each self-referential M:N leg to the junction relation field it names', () => {
    const result = interpret(`model User {
  id Int @id
  following User[] @relation(through: Follow.follower)
  followers User[] @relation(through: Follow.followee)
}

${selfRelationFollowJunction}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['User']?.relations).toEqual({
      following: {
        to: crossRef('User', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['followerId'] },
        through: {
          table: 'follow',
          namespaceId: 'public',
          parentColumns: ['followerId'],
          childColumns: ['followeeId'],
          targetColumns: ['id'],
        },
      },
      followers: {
        to: crossRef('User', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['followeeId'] },
        through: {
          table: 'follow',
          namespaceId: 'public',
          parentColumns: ['followeeId'],
          childColumns: ['followerId'],
          targetColumns: ['id'],
        },
      },
    });

    const envelope = JSON.parse(JSON.stringify(result.value)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });

  it('defers the same self-relation to the ambiguity diagnostic when through: is unqualified (control)', () => {
    const result = interpret(`model User {
  id Int @id
  following User[] @relation(through: Follow)
  followers User[] @relation(through: Follow)
}

${selfRelationFollowJunction}`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_AMBIGUOUS_BACKRELATION_LIST',
          message: expect.stringContaining('User.following'),
        }),
      ]),
    );
  });

  it('emits an actionable diagnostic when through: names a field that is not a junction FK back to the candidate', () => {
    const result = interpret(`model User {
  id Int @id
  following User[] @relation(through: Follow.notAField)
  followers User[] @relation(through: Follow.followee)
}

${selfRelationFollowJunction}`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const diagnostic = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_JUNCTION_THROUGH_FIELD_NOT_FK',
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain('User.following');
    expect(diagnostic?.message).toContain('Follow');
    expect(diagnostic?.message).toContain('notAField');
  });
});
