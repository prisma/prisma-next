import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToSqlContractIR } from '../src/interpreter';

describe('interpretPslDocumentToSqlContractIR relations', () => {
  it('accepts relation navigation list fields and emits relation metadata for both sides', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.relations).toMatchObject({
      user: {
        posts: {
          to: 'Post',
          cardinality: '1:N',
          on: {
            parentCols: ['id'],
            childCols: ['userId'],
          },
        },
      },
      post: {
        user: {
          to: 'User',
          cardinality: 'N:1',
          on: {
            parentCols: ['userId'],
            childCols: ['id'],
          },
        },
      },
    });
  });

  it('matches named backrelations using positional and named relation forms', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  authored Post[] @relation("AuthoredPosts")
  reviewed Post[] @relation(name: "ReviewedPosts")
}

model Post {
  id Int @id
  authorId Int
  reviewerId Int
  author User @relation("AuthoredPosts", fields: [authorId], references: [id])
  reviewer User @relation(name: "ReviewedPosts", fields: [reviewerId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.relations['user']).toMatchObject({
      authored: {
        to: 'Post',
        cardinality: '1:N',
        on: {
          parentCols: ['id'],
          childCols: ['authorId'],
        },
      },
      reviewed: {
        to: 'Post',
        cardinality: '1:N',
        on: {
          parentCols: ['id'],
          childCols: ['reviewerId'],
        },
      },
    });
  });

  it('matches backrelations with unrelated FK metadata present', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  posts Post[]
}

model Post {
  id Int @id
  userId Int
  user User @relation(fields: [userId], references: [id])
}

model Team {
  id Int @id
}

model Member {
  id Int @id
  teamId Int
  team Team @relation(fields: [teamId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractIR({ document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.relations).toMatchObject({
      user: {
        posts: {
          to: 'Post',
          cardinality: '1:N',
        },
      },
      post: {
        user: {
          to: 'User',
          cardinality: 'N:1',
        },
      },
      member: {
        team: {
          to: 'Team',
          cardinality: 'N:1',
        },
      },
    });
  });
});
