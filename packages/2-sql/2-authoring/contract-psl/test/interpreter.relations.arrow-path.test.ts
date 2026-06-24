import type { Contract } from '@prisma-next/contract/types';
import { crossRef } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateSqlContractFully } from '@prisma-next/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
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
} as const;

function interpret(schema: string) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  return interpretPslDocumentToSqlContract({ ...baseInput, ...document });
}

function relationsOf(contract: Contract) {
  return modelsOf(contract) as Record<string, { relations?: Record<string, unknown> }>;
}

describe('interpretPslDocumentToSqlContract arrow-path through: many-to-many', () => {
  it('lowers an arrow-path over a relation-field-less junction to N:M + through', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[] @relation(through: "id -> PostTag.postId -> PostTag.tagId -> Tag.id")
}

model Tag {
  id Int @id
  posts Post[] @relation(through: "id -> PostTag.tagId -> PostTag.postId -> Post.id")
}

model PostTag {
  postId Int
  tagId Int

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

    const envelope = JSON.parse(JSON.stringify(result.value)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });

  it('lowers an arrow-path to the same N:M contract as the relation-field junction form', () => {
    const arrow = interpret(`model Post {
  id Int @id
  tags Tag[] @relation(through: "id -> PostTag.postId -> PostTag.tagId -> Tag.id")
}

model Tag {
  id Int @id
  posts Post[] @relation(through: "id -> PostTag.tagId -> PostTag.postId -> Post.id")
}

model PostTag {
  postId Int
  tagId Int

  @@id([postId, tagId])
}
`);
    const relationField = interpret(`model Post {
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
  post Post @relation(fields: [postId], references: [id])
  tag Tag @relation(fields: [tagId], references: [id])

  @@id([postId, tagId])
}
`);

    expect(arrow.ok).toBe(true);
    expect(relationField.ok).toBe(true);
    if (!arrow.ok || !relationField.ok) return;

    const arrowModels = relationsOf(arrow.value);
    const relationFieldModels = relationsOf(relationField.value);
    expect(arrowModels['Post']?.relations).toEqual(relationFieldModels['Post']?.relations);
    expect(arrowModels['Tag']?.relations).toEqual(relationFieldModels['Tag']?.relations);
  });

  it('maps domain field names through @map to their storage columns', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[] @relation(through: "id -> PostTag.postId -> PostTag.tagId -> Tag.id")

  @@map("posts")
}

model Tag {
  id Int @id
  posts Post[] @relation(through: "id -> PostTag.tagId -> PostTag.postId -> Post.id")

  @@map("tags")
}

model PostTag {
  postId Int @map("post_id")
  tagId Int @map("tag_id")

  @@id([postId, tagId])
  @@map("post_tags")
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const models = relationsOf(result.value);
    expect(models['Post']?.relations).toEqual({
      tags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['post_id'] },
        through: {
          table: 'post_tags',
          namespaceId: 'public',
          parentColumns: ['post_id'],
          childColumns: ['tag_id'],
          targetColumns: ['id'],
        },
      },
    });

    const envelope = JSON.parse(JSON.stringify(result.value)) as unknown;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(envelope)).not.toThrow();
  });

  it('resolves a self-referential arrow-path M:N via the near/far columns', () => {
    const result = interpret(`model User {
  id Int @id
  following User[] @relation(through: "id -> Follow.followerId -> Follow.followeeId -> User.id")
  followers User[] @relation(through: "id -> Follow.followeeId -> Follow.followerId -> User.id")
}

model Follow {
  followerId Int
  followeeId Int

  @@id([followerId, followeeId])
}
`);

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

  it('diagnoses a malformed arrow path that is not four segments', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[] @relation(through: "id -> PostTag.postId -> Tag.id")
}

model Tag {
  id Int @id
}

model PostTag {
  postId Int
  tagId Int

  @@id([postId, tagId])
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const diagnostic = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_ARROW_PATH_MALFORMED',
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain('Post.tags');
  });

  it('diagnoses an arrow path naming a column absent on its model', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[] @relation(through: "id -> PostTag.missingCol -> PostTag.tagId -> Tag.id")
}

model Tag {
  id Int @id
}

model PostTag {
  postId Int
  tagId Int

  @@id([postId, tagId])
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const diagnostic = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_ARROW_PATH_COLUMN_NOT_FOUND',
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain('PostTag');
    expect(diagnostic?.message).toContain('missingCol');
  });

  it('diagnoses an arrow path whose two junction columns name different models', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[] @relation(through: "id -> PostTag.postId -> Other.tagId -> Tag.id")
}

model Tag {
  id Int @id
}

model PostTag {
  postId Int

  @@id([postId])
}

model Other {
  tagId Int

  @@id([tagId])
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const diagnostic = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_ARROW_PATH_JUNCTION_MISMATCH',
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain('PostTag');
    expect(diagnostic?.message).toContain('Other');
  });

  it('diagnoses an arrow path whose junction is not a declared model', () => {
    const result = interpret(`model Post {
  id Int @id
  tags Tag[] @relation(through: "id -> NotAModel.postId -> NotAModel.tagId -> Tag.id")
}

model Tag {
  id Int @id
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const diagnostic = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_ARROW_PATH_JUNCTION_NOT_MODEL',
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain('NotAModel');
  });
});
