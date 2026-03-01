import { describe, expect, it } from 'vitest';
import { parsePslDocument } from '../src/parser';

describe('parsePslDocument', () => {
  it('parses representative v1 schema with generic attributes and spans', () => {
    const schema = `
types {
  Email = String @db.VarChar(191)
}

enum Role {
  USER
  ADMIN
}

model User {
  id Int @id @default(autoincrement())
  email Email @unique
  role Role
  posts Post[]
}

model Post {
  id Int @id @default(autoincrement())
  userId Int
  user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: SetNull)
  createdAt DateTime @default(now())
  published Boolean @default(true)
  @@index([userId])
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.ast.models).toHaveLength(2);
    expect(result.ast.enums).toHaveLength(1);
    expect(result.ast.types?.declarations).toHaveLength(1);
    expect(result.ast.span.start.line).toBe(1);
    expect(result.ast.span.end.line).toBeGreaterThan(1);

    const userModel = result.ast.models.find((model) => model.name === 'User');
    expect(userModel).toBeDefined();
    const emailField = userModel?.fields.find((field) => field.name === 'email');
    expect(emailField?.typeRef).toBe('Email');
    const namedType = result.ast.types?.declarations[0];
    expect(namedType?.attributes[0]).toMatchObject({
      kind: 'attribute',
      target: 'namedType',
      name: 'db.VarChar',
      args: [{ kind: 'positional', value: '191' }],
    });

    const postModel = result.ast.models.find((model) => model.name === 'Post');
    const relationField = postModel?.fields.find((field) => field.name === 'user');
    const relationAttribute = relationField?.attributes.find(
      (attribute) => attribute.name === 'relation',
    );
    expect(relationAttribute).toMatchObject({
      kind: 'attribute',
      target: 'field',
      name: 'relation',
      args: [
        { kind: 'named', name: 'fields', value: '[userId]' },
        { kind: 'named', name: 'references', value: '[id]' },
        { kind: 'named', name: 'onDelete', value: 'Cascade' },
        { kind: 'named', name: 'onUpdate', value: 'SetNull' },
      ],
    });
  });

  it('parses field namespaced parameterized attributes', () => {
    const schema = `
types {
  Embedding1536 = Bytes @pgvector.column(length: 1536)
}

model Document {
  id Int @id
  embedding Embedding1536 @pgvector.column(length: 1536)
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    const documentModel = result.ast.models.find((model) => model.name === 'Document');
    const embeddingField = documentModel?.fields.find((field) => field.name === 'embedding');
    const embeddingAttribute = embeddingField?.attributes.find(
      (attribute) => attribute.name === 'pgvector.column',
    );
    expect(embeddingAttribute).toMatchObject({
      kind: 'attribute',
      target: 'field',
      name: 'pgvector.column',
      args: [{ kind: 'named', name: 'length', value: '1536' }],
    });

    const namedType = result.ast.types?.declarations.find(
      (entry) => entry.name === 'Embedding1536',
    );
    expect(namedType?.attributes[0]).toMatchObject({
      kind: 'attribute',
      target: 'namedType',
      name: 'pgvector.column',
      args: [{ kind: 'named', name: 'length', value: '1536' }],
    });
  });

  it('parses hyphenated namespace attribute names', () => {
    const schema = `
model Document {
  id Int @id
  embedding Bytes @my-pack.column(length: 1536)
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    const documentModel = result.ast.models.find((model) => model.name === 'Document');
    const embeddingField = documentModel?.fields.find((field) => field.name === 'embedding');
    expect(
      embeddingField?.attributes.find((attribute) => attribute.name === 'my-pack.column'),
    ).toMatchObject({
      kind: 'attribute',
      target: 'field',
      name: 'my-pack.column',
      args: [{ kind: 'named', name: 'length', value: '1536' }],
    });
  });

  it('parses @map and @@map through generic attributes', () => {
    const schema = `
model Account {
  id Int @id
  email String @map("email_address")
  @@map("app_accounts")
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    const accountModel = result.ast.models.find((model) => model.name === 'Account');
    const emailField = accountModel?.fields.find((field) => field.name === 'email');
    expect(emailField?.attributes.find((attribute) => attribute.name === 'map')).toMatchObject({
      kind: 'attribute',
      target: 'field',
      name: 'map',
      args: [{ kind: 'positional', value: '"email_address"' }],
    });
    expect(accountModel?.attributes.find((attribute) => attribute.name === 'map')).toMatchObject({
      kind: 'attribute',
      target: 'model',
      name: 'map',
      args: [{ kind: 'positional', value: '"app_accounts"' }],
    });
  });

  it('returns diagnostics for malformed attribute syntax', () => {
    const schema = `
model User {
  id Int @id
  email String @pgvector.column(length: )
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((entry) => entry.code === 'PSL_INVALID_ATTRIBUTE_SYNTAX')).toBe(
      true,
    );
  });

  it('fails strictly for unsupported top-level constructs', () => {
    const schema = `
datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}

model User {
  id Int @id
  @@map("users")
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((entry) => entry.code === 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK'),
    ).toBe(true);
    expect(
      result.diagnostics.some((entry) => entry.code === 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE'),
    ).toBe(false);
  });

  it('parses trailing model attribute arguments generically', () => {
    const schema = `
model Post {
  id Int @id
  userId Int
  @@index([userId], map: "post_user_idx")
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const postModel = result.ast.models.find((model) => model.name === 'Post');
    expect(postModel?.attributes.find((attribute) => attribute.name === 'index')).toMatchObject({
      kind: 'attribute',
      target: 'model',
      name: 'index',
      args: [
        { kind: 'positional', value: '[userId]' },
        { kind: 'named', name: 'map', value: '"post_user_idx"' },
      ],
    });
  });

  it('is deterministic for identical input', () => {
    const schema = `
model User {
  id Int @id
  email String @unique
}
`;

    const first = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });
    const second = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(first).toEqual(second);
  });

  it('parses blocks with braces inside string defaults', () => {
    const schema = `
model User {
  id Int @id
  pattern String @default("{foo}")
}

model Post {
  id Int @id
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.ast.models.map((model) => model.name)).toEqual(['User', 'Post']);
  });

  it('returns diagnostics when named types collide with scalar or model names', () => {
    const schema = `
types {
  String = String @db.VarChar(191)
  User = String @db.VarChar(191)
}

model User {
  id Int @id
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(false);
    const messages = result.diagnostics
      .filter((entry) => entry.code === 'PSL_INVALID_TYPES_MEMBER')
      .map((entry) => entry.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('conflicts with scalar type "String"'),
        expect.stringContaining('conflicts with model name "User"'),
      ]),
    );
  });

  it('returns diagnostics when named types collide with enum names', () => {
    const schema = `
types {
  Role = String
}

enum Role {
  USER
  ADMIN
}

model User {
  id Int @id
  role Role
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(false);
    const messages = result.diagnostics
      .filter((entry) => entry.code === 'PSL_INVALID_TYPES_MEMBER')
      .map((entry) => entry.message);
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining('conflicts with enum name "Role"')]),
    );

    const userModel = result.ast.models.find((model) => model.name === 'User');
    const roleField = userModel?.fields.find((field) => field.name === 'role');
    expect(roleField?.typeName).toBe('Role');
    expect(roleField?.typeRef).toBeUndefined();
  });
});
