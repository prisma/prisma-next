import type { AuthoringPslBlockDescriptor } from '@prisma-next/framework-components/authoring';
import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import {
  flatPslCompositeTypes,
  flatPslEnums,
  flatPslModels,
  namespacePslExtensionBlocks,
} from '@prisma-next/framework-components/psl-ast';
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
    expect(flatPslModels(result.ast)).toHaveLength(2);
    expect(flatPslEnums(result.ast)).toHaveLength(1);
    expect(result.ast.types?.declarations).toHaveLength(1);
    expect(result.ast.span.start.line).toBe(1);
    expect(result.ast.span.end.line).toBeGreaterThan(1);

    const userModel = flatPslModels(result.ast).find((model) => model.name === 'User');
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

    const postModel = flatPslModels(result.ast).find((model) => model.name === 'Post');
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

  it('parses namespaced parameterized attributes generically', () => {
    const schema = `
types {
  PackedValue = Bytes @vendor.column(length: 1536)
}

model Document {
  id Int @id
  payload PackedValue @vendor.column(length: 1536)
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    const documentModel = flatPslModels(result.ast).find((model) => model.name === 'Document');
    const payloadField = documentModel?.fields.find((field) => field.name === 'payload');
    const payloadAttribute = payloadField?.attributes.find(
      (attribute) => attribute.name === 'vendor.column',
    );
    expect(payloadAttribute).toMatchObject({
      kind: 'attribute',
      target: 'field',
      name: 'vendor.column',
      args: [{ kind: 'named', name: 'length', value: '1536' }],
    });

    const namedType = result.ast.types?.declarations.find((entry) => entry.name === 'PackedValue');
    expect(namedType?.attributes[0]).toMatchObject({
      kind: 'attribute',
      target: 'namedType',
      name: 'vendor.column',
      args: [{ kind: 'named', name: 'length', value: '1536' }],
    });
  });

  it('parses named type constructor expressions in types blocks', () => {
    const schema = `
types {
  ShortName = sql.String(length: 35)
  Embedding1536 = pgvector.Vector(1536)
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);

    const shortName = result.ast.types?.declarations.find((entry) => entry.name === 'ShortName');
    expect(shortName).toMatchObject({
      kind: 'namedType',
      name: 'ShortName',
      typeConstructor: {
        path: ['sql', 'String'],
        args: [{ kind: 'named', name: 'length', value: '35' }],
      },
    });

    const embedding = result.ast.types?.declarations.find(
      (entry) => entry.name === 'Embedding1536',
    );
    expect(embedding).toMatchObject({
      kind: 'namedType',
      name: 'Embedding1536',
      typeConstructor: {
        path: ['pgvector', 'Vector'],
        args: [{ kind: 'positional', value: '1536' }],
      },
    });
  });

  it('parses attributes attached to named type constructor expressions', () => {
    const schema = `
types {
  Embedding1536 = pgvector.Vector(1536) @db.VarChar(191)
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);

    const embedding = result.ast.types?.declarations.find(
      (entry) => entry.name === 'Embedding1536',
    );
    expect(embedding).toMatchObject({
      kind: 'namedType',
      name: 'Embedding1536',
      typeConstructor: {
        path: ['pgvector', 'Vector'],
        args: [{ kind: 'positional', value: '1536' }],
      },
      attributes: [
        {
          kind: 'attribute',
          target: 'namedType',
          name: 'db.VarChar',
          args: [{ kind: 'positional', value: '191' }],
        },
      ],
    });
  });

  it('parses inline field constructor expressions', () => {
    const schema = `
model Document {
  id Int @id
  shortName sql.String(length: 35)
  embedding pgvector.Vector(length: 1536)?
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);

    const documentModel = flatPslModels(result.ast).find((model) => model.name === 'Document');
    const shortNameField = documentModel?.fields.find((field) => field.name === 'shortName');
    expect(shortNameField).toMatchObject({
      kind: 'field',
      name: 'shortName',
      optional: false,
      list: false,
      typeConstructor: {
        path: ['sql', 'String'],
        args: [{ kind: 'named', name: 'length', value: '35' }],
      },
    });

    const embeddingField = documentModel?.fields.find((field) => field.name === 'embedding');
    expect(embeddingField).toMatchObject({
      kind: 'field',
      name: 'embedding',
      optional: true,
      list: false,
      typeConstructor: {
        path: ['pgvector', 'Vector'],
        args: [{ kind: 'named', name: 'length', value: '1536' }],
      },
    });
  });

  it('parses JS-like object literals as constructor arguments', () => {
    const schema = `
types {
  ShortName = sql.String({ length: 35, label: 'short' })
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);

    const shortName = result.ast.types?.declarations.find((entry) => entry.name === 'ShortName');
    expect(shortName).toMatchObject({
      kind: 'namedType',
      name: 'ShortName',
      typeConstructor: {
        path: ['sql', 'String'],
        args: [{ kind: 'positional', value: "{ length: 35, label: 'short' }" }],
      },
    });
  });

  it('parses constructor arguments and trailing attributes after quoted values ending with escaped backslashes', () => {
    const schema = String.raw`
types {
  WindowsPath = sql.String(label: "C:\\\\", length: 35) @db.VarChar(191)
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const windowsPath = result.ast.types?.declarations.find(
      (entry) => entry.name === 'WindowsPath',
    );
    expect(windowsPath?.typeConstructor).toMatchObject({
      path: ['sql', 'String'],
      args: [
        { kind: 'named', name: 'label' },
        { kind: 'named', name: 'length', value: '35' },
      ],
    });
    expect(windowsPath?.attributes).toMatchObject([
      {
        kind: 'attribute',
        target: 'namedType',
        name: 'db.VarChar',
        args: [{ kind: 'positional', value: '191' }],
      },
    ]);
  });

  it('strips inline comments after quoted values ending with escaped backslashes', () => {
    const schema = String.raw`
model File {
  id Int @id
  path String @default("C:\\\\") // keep this as a Windows-style path
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const fileModel = flatPslModels(result.ast).find((model) => model.name === 'File');
    const pathField = fileModel?.fields.find((field) => field.name === 'path');
    expect(pathField?.attributes).toMatchObject([
      {
        kind: 'attribute',
        target: 'field',
        name: 'default',
        args: [{ kind: 'positional', value: '"C:\\\\\\\\"' }],
      },
    ]);
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
    const documentModel = flatPslModels(result.ast).find((model) => model.name === 'Document');
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
    const accountModel = flatPslModels(result.ast).find((model) => model.name === 'Account');
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

  it('parses enum @@map through generic attributes', () => {
    const schema = `
enum UserRole {
  USER
  ADMIN
  @@map("user_role")
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    const userRole = flatPslEnums(result.ast).find((enumBlock) => enumBlock.name === 'UserRole');
    expect(userRole?.attributes.find((attribute) => attribute.name === 'map')).toMatchObject({
      kind: 'attribute',
      target: 'enum',
      name: 'map',
      args: [{ kind: 'positional', value: '"user_role"' }],
    });
  });

  it('captures per-member @map storage labels', () => {
    // The printer emits `@map("...")` on a member line whenever it had to
    // normalise the storage label into a valid PSL identifier (e.g. Postgres
    // enum labels with hyphens or PSL reserved words). The parser captures
    // the original storage label as `mapName` on the corresponding
    // `PslEnumValue`, so a parse → print → parse round-trip preserves it.
    const schema = `
enum Status {
  inProgress @map("in-progress")
  _enum @map("enum")
  done
}
`;

    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
    expect(result.ok).toBe(true);
    const status = flatPslEnums(result.ast).find((e) => e.name === 'Status');
    expect(status?.values.map((v) => ({ name: v.name, mapName: v.mapName }))).toEqual([
      { name: 'inProgress', mapName: 'in-progress' },
      { name: '_enum', mapName: 'enum' },
      { name: 'done', mapName: undefined },
    ]);
  });

  it('decodes PSL escape sequences in per-member @map storage labels', () => {
    // The parser must apply the inverse of escapePslString so a label like
    // `name with "quotes" and \\backslash` survives a parse → print → parse
    // round-trip without doubling escapes.
    const schema = `
enum Quoted {
  hasQuote @map("with \\"quote\\"")
  hasBackslash @map("with \\\\back")
  hasNewline @map("line1\\nline2")
}
`;

    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
    expect(result.ok).toBe(true);
    const quoted = flatPslEnums(result.ast).find((e) => e.name === 'Quoted');
    expect(quoted?.values.map((v) => v.mapName)).toEqual([
      'with "quote"',
      'with \\back',
      'line1\nline2',
    ]);
  });

  it('returns diagnostics for malformed attribute syntax', () => {
    const schema = `
model User {
  id Int @id
  email String @vendor.column(length: )
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

    const postModel = flatPslModels(result.ast).find((model) => model.name === 'Post');
    const indexAttribute = postModel?.attributes.find((attribute) => attribute.name === 'index');
    expect(indexAttribute).toMatchObject({
      kind: 'attribute',
      target: 'model',
      name: 'index',
      args: [
        { kind: 'positional', value: '[userId]' },
        { kind: 'named', name: 'map', value: '"post_user_idx"' },
      ],
    });
  });

  it('parses relation name arguments in positional and named forms with spans', () => {
    const schema = `
model User {
  id Int @id
  posts Post[] @relation("UserPosts")
  authored Post[] @relation(name: "AuthorPosts")
}

model Post {
  id Int @id
  userId Int
  authorId Int
  user User @relation("UserPosts", fields: [userId], references: [id])
  author User @relation(name: "AuthorPosts", fields: [authorId], references: [id])
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const userModel = flatPslModels(result.ast).find((model) => model.name === 'User');
    const postsField = userModel?.fields.find((field) => field.name === 'posts');
    const authoredField = userModel?.fields.find((field) => field.name === 'authored');

    const postsRelation = postsField?.attributes.find((attribute) => attribute.name === 'relation');
    const authoredRelation = authoredField?.attributes.find(
      (attribute) => attribute.name === 'relation',
    );

    expect(postsRelation?.args).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'positional',
          value: '"UserPosts"',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 4 }),
          }),
        }),
      ]),
    );

    expect(authoredRelation?.args).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'named',
          name: 'name',
          value: '"AuthorPosts"',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 5 }),
          }),
        }),
      ]),
    );
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
    expect(flatPslModels(result.ast).map((model) => model.name)).toEqual(['User', 'Post']);
  });

  it('parses default function expressions used for ID parity fixtures', () => {
    const schema = `
model Defaults {
  id Int @id
  uuidDefault String @default(uuid())
  uuidV4 String @default(uuid(4))
  uuidV7 String @default(uuid(7))
  ulidDefault String @default(ulid())
  nanoidDefault String @default(nanoid())
  nanoidSized String @default(nanoid(16))
  dbExpr String @default(dbgenerated("gen_random_uuid()"))
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);

    const defaultsModel = flatPslModels(result.ast).find((model) => model.name === 'Defaults');
    expect(defaultsModel).toBeDefined();

    const byFieldName = new Map(defaultsModel?.fields.map((field) => [field.name, field]));
    const expressionByField: Record<string, string> = {
      uuidDefault: 'uuid()',
      uuidV4: 'uuid(4)',
      uuidV7: 'uuid(7)',
      ulidDefault: 'ulid()',
      nanoidDefault: 'nanoid()',
      nanoidSized: 'nanoid(16)',
      dbExpr: 'dbgenerated("gen_random_uuid()")',
    };

    for (const [fieldName, expression] of Object.entries(expressionByField)) {
      const field = byFieldName.get(fieldName);
      const defaultAttribute = field?.attributes.find((attribute) => attribute.name === 'default');
      expect(defaultAttribute).toMatchObject({
        kind: 'attribute',
        target: 'field',
        name: 'default',
        args: [{ kind: 'positional', value: expression }],
      });
      expect(defaultAttribute?.span.start.line).toBeGreaterThan(1);
      expect(defaultAttribute?.span.end.line).toBe(defaultAttribute?.span.start.line);
    }
  });

  it('returns diagnostics for malformed default expressions with spans', () => {
    const schema = `
model BrokenDefaults {
  id Int @id
  missingParen String @default(uuid(
  unterminatedString String @default(dbgenerated("gen_random_uuid()))
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 4 }),
          }),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          sourceId: 'schema.prisma',
          span: expect.objectContaining({
            start: expect.objectContaining({ line: 5 }),
          }),
        }),
      ]),
    );
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

  it('returns PSL_INVALID_TYPES_MEMBER for a types-block constructor with trailing junk', () => {
    const schema = `
types {
  ShortName = sql.String(35) trailing
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
        expect.stringContaining('Invalid types declaration "sql.String(35) trailing"'),
      ]),
    );
  });

  it('returns PSL_INVALID_MODEL_MEMBER for an inline field constructor with trailing junk', () => {
    const schema = `
model User {
  id    Int @id
  name  sql.String(35) junk
}
`;

    const result = parsePslDocument({
      schema,
      sourceId: 'schema.prisma',
    });

    expect(result.ok).toBe(false);
    const messages = result.diagnostics
      .filter((entry) => entry.code === 'PSL_INVALID_MODEL_MEMBER')
      .map((entry) => entry.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Invalid field type constructor "sql.String(35) junk"'),
      ]),
    );
  });

  it('returns a named-argument diagnostic for a malformed constructor call', () => {
    const schema = `
types {
  ShortName = sql.String(length:)
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
    const messages = result.diagnostics.map((entry) => entry.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Invalid named argument syntax'),
        expect.stringContaining('type constructor'),
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

    const userModel = flatPslModels(result.ast).find((model) => model.name === 'User');
    const roleField = userModel?.fields.find((field) => field.name === 'role');
    expect(roleField?.typeName).toBe('Role');
    expect(roleField?.typeRef).toBeUndefined();
  });
});

describe('composite type blocks', () => {
  it('parses type X { ... } as compositeType with fields', () => {
    const schema = `
type Address {
  street String
  city   String
  zip    String?
}

model User {
  id      Int     @id
  name    String
  address Address
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
    expect(result.ok).toBe(true);
    expect(flatPslCompositeTypes(result.ast)).toHaveLength(1);

    const address = flatPslCompositeTypes(result.ast)[0]!;
    expect(address.kind).toBe('compositeType');
    expect(address.name).toBe('Address');
    expect(address.fields).toHaveLength(3);
    expect(address.fields[0]!.name).toBe('street');
    expect(address.fields[0]!.typeName).toBe('String');
    expect(address.fields[2]!.optional).toBe(true);
  });

  it('does not add typeRef for composite type field references on models', () => {
    const schema = `
type Address {
  street String
}

types {
  PostalCode = String
}

model User {
  id      Int
  address Address
  zip     PostalCode
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
    expect(result.ok).toBe(true);

    const userModel = flatPslModels(result.ast).find((m) => m.name === 'User')!;
    const addressField = userModel.fields.find((f) => f.name === 'address')!;
    expect(addressField.typeName).toBe('Address');
    expect(addressField.typeRef).toBeUndefined();

    const zipField = userModel.fields.find((f) => f.name === 'zip')!;
    expect(zipField.typeName).toBe('PostalCode');
    expect(zipField.typeRef).toBe('PostalCode');
  });

  it('parses nested composite type references within composite types', () => {
    const schema = `
type GeoPoint {
  lat Float
  lng Float
}

type Address {
  street   String
  location GeoPoint
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
    expect(result.ok).toBe(true);
    expect(flatPslCompositeTypes(result.ast)).toHaveLength(2);

    const address = flatPslCompositeTypes(result.ast).find((ct) => ct.name === 'Address')!;
    const locationField = address.fields.find((f) => f.name === 'location')!;
    expect(locationField.typeName).toBe('GeoPoint');
  });

  it('parses composite type with list fields', () => {
    const schema = `
type Address {
  tags String[]
}
`;
    const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
    expect(result.ok).toBe(true);
    const address = flatPslCompositeTypes(result.ast)[0]!;
    const tagsField = address.fields.find((f) => f.name === 'tags')!;
    expect(tagsField.list).toBe(true);
    expect(tagsField.typeName).toBe('String');
  });

  describe('namespace blocks', () => {
    it('parses a named namespace block and routes declarations into its bucket', () => {
      const schema = `
model TopLevel {
  id Int @id
}

namespace auth {
  model User {
    id Int @id
  }

  enum Role {
    ADMIN
    MEMBER
  }
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
      expect(result.ast.namespaces.map((ns) => ns.name)).toEqual(['__unspecified__', 'auth']);

      const top = result.ast.namespaces.find((ns) => ns.name === '__unspecified__');
      expect(top?.models.map((m) => m.name)).toEqual(['TopLevel']);
      expect(top?.enums).toEqual([]);

      const auth = result.ast.namespaces.find((ns) => ns.name === 'auth');
      expect(auth?.models.map((m) => m.name)).toEqual(['User']);
      expect(auth?.enums.map((e) => e.name)).toEqual(['Role']);
    });

    it('drops the synthesised __unspecified__ bucket when every declaration is namespaced', () => {
      const schema = `
namespace auth {
  model User {
    id Int @id
  }
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      expect(result.ast.namespaces.map((ns) => ns.name)).toEqual(['auth']);
    });

    it('reopens and merges multiple namespace blocks with the same name', () => {
      const schema = `
namespace auth {
  model User {
    id Int @id
  }
}

namespace auth {
  enum Role {
    ADMIN
    MEMBER
  }
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
      expect(result.ast.namespaces).toHaveLength(1);
      const auth = result.ast.namespaces[0]!;
      expect(auth.name).toBe('auth');
      expect(auth.models.map((m) => m.name)).toEqual(['User']);
      expect(auth.enums.map((e) => e.name)).toEqual(['Role']);
    });

    it('rejects a recursive namespace block as a parse diagnostic', () => {
      const schema = `
namespace outer {
  namespace inner {
    model X {
      id Int @id
    }
  }
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.diagnostics.map((d) => d.code)).toContain('PSL_INVALID_NAMESPACE_BLOCK');
      const recursive = result.diagnostics.find(
        (d) => d.code === 'PSL_INVALID_NAMESPACE_BLOCK' && /inner/.test(d.message),
      );
      expect(recursive).toBeDefined();
    });

    it('rejects a `types` block declared inside a namespace block', () => {
      const schema = `
namespace auth {
  types {
    Email = String
  }
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      const offending = result.diagnostics.find(
        (d) =>
          d.code === 'PSL_INVALID_NAMESPACE_BLOCK' &&
          /types` blocks must be declared at the document top level/.test(d.message),
      );
      expect(offending).toBeDefined();
    });

    it('rejects a user-authored namespace named __unspecified__', () => {
      const schema = `
namespace __unspecified__ {
  model X {
    id Int @id
  }
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(
        result.diagnostics.some(
          (d) => d.code === 'PSL_INVALID_NAMESPACE_BLOCK' && /reserved/.test(d.message),
        ),
      ).toBe(true);
    });

    it('does not reserve identifiers like `unbound`, `public`, or `auth` at the framework parser layer', () => {
      const schema = `
namespace unbound {
  model A {
    id Int @id
  }
}

namespace public {
  model B {
    id Int @id
  }
}

namespace auth {
  model C {
    id Int @id
  }
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
      expect(result.ast.namespaces.map((ns) => ns.name).sort()).toEqual([
        'auth',
        'public',
        'unbound',
      ]);
    });
  });

  describe('dot-qualified field types', () => {
    it('parses a qualified type reference into typeName + typeNamespaceId', () => {
      const schema = `
model Profile {
  id Int @id
  user auth.User @relation(fields: [userId], references: [id])
  userId Int
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
      const profile = flatPslModels(result.ast).find((m) => m.name === 'Profile');
      const userField = profile?.fields.find((f) => f.name === 'user');
      expect(userField?.typeName).toBe('User');
      expect(userField?.typeNamespaceId).toBe('auth');
    });

    it('parses a qualified list type reference', () => {
      const schema = `
model User {
  id Int @id
  posts public.Post[]
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
      const user = flatPslModels(result.ast).find((m) => m.name === 'User');
      const postsField = user?.fields.find((f) => f.name === 'posts');
      expect(postsField?.typeName).toBe('Post');
      expect(postsField?.typeNamespaceId).toBe('public');
      expect(postsField?.list).toBe(true);
    });

    it('rejects nested dot-qualified types with a parse error', () => {
      const schema = `
model Foo {
  id Int @id
  bar a.b.Bar
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe('PSL_INVALID_QUALIFIED_TYPE');
      expect(result.diagnostics[0]?.message).toContain('a.b.Bar');
      expect(result.diagnostics[0]?.span).toBeDefined();
    });

    it('rejects nested dot-qualified list types with a parse error', () => {
      const schema = `
model Foo {
  id Int @id
  bars a.b.Bar[]
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe('PSL_INVALID_QUALIFIED_TYPE');
    });

    it('leaves unqualified types unchanged (no typeNamespaceId)', () => {
      const schema = `
model Post {
  id Int @id
  title String
  published Boolean @default(false)
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      const post = flatPslModels(result.ast).find((m) => m.name === 'Post');
      const titleField = post?.fields.find((f) => f.name === 'title');
      expect(titleField?.typeName).toBe('String');
      expect(titleField?.typeNamespaceId).toBeUndefined();
    });
  });

  describe('extension blocks (generic framework parser)', () => {
    // Stub codecLookup: supplies a minimal Codec for the 'sql-expression' codec
    // whose decodeJson accepts any JSON string value.
    // Needed because the parser wires the validator into parsePslDocument, which
    // runs whenever pslBlockDescriptors are registered and falls back to emptyCodecLookup
    // (which has no codecs registered) when no codecLookup is supplied by the caller.
    const stubSqlExpressionCodec: Codec = {
      id: 'sql-expression',
      encode: async (value) => value,
      decode: async (wire) => wire,
      encodeJson: (value) => value as string,
      decodeJson: (json) => json as string,
    };
    const stubSqlExpressionCodecLookup: CodecLookup = {
      get: (id) => (id === 'sql-expression' ? stubSqlExpressionCodec : undefined),
      getForRef: () => undefined,
      targetTypesFor: () => undefined,
      metaFor: () => undefined,
      renderOutputTypeFor: () => undefined,
    };

    const policySelectDescriptor: AuthoringPslBlockDescriptor = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'test-policy-select',
      name: { required: true },
      parameters: {
        target: { kind: 'ref', refKind: 'model', scope: 'same-namespace' },
        as: { kind: 'option', values: ['permissive', 'restrictive'] },
        // cross-space: roles are external entities; validation is a documented pass-through.
        roles: { kind: 'list', of: { kind: 'ref', refKind: 'role', scope: 'cross-space' } },
        using: { kind: 'value', codecId: 'sql-expression' },
      },
    };

    it('parses a policy_select block into a uniform PslExtensionBlock node', () => {
      const schema = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  as = permissive
  roles = [admin, editor]
  using = "true"
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
        codecLookup: stubSqlExpressionCodecLookup,
      });

      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);

      const ns = result.ast.namespaces[0];
      expect(ns).toBeDefined();
      const nsExtBlocks = namespacePslExtensionBlocks(ns!);
      expect(nsExtBlocks).toHaveLength(1);

      const block = nsExtBlocks[0];
      expect(block?.kind).toBe('test-policy-select');
      expect(block?.name).toBe('ReadPosts');
      expect(block?.span).toBeDefined();

      expect(block?.parameters['target']).toMatchObject({
        kind: 'ref',
        identifier: 'Post',
      });

      expect(block?.parameters['as']).toMatchObject({
        kind: 'option',
        token: 'permissive',
      });

      expect(block?.parameters['roles']).toMatchObject({
        kind: 'list',
        items: [
          { kind: 'ref', identifier: 'admin' },
          { kind: 'ref', identifier: 'editor' },
        ],
      });

      expect(block?.parameters['using']).toMatchObject({
        kind: 'value',
        raw: '"true"',
      });
    });

    it('emits PSL_UNSUPPORTED_TOP_LEVEL_BLOCK for an unregistered keyword', () => {
      const schema = `
unknown_keyword Foo {
  target = Bar
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe('PSL_UNSUPPORTED_TOP_LEVEL_BLOCK');
      expect(result.diagnostics[0]?.message).toContain('unknown_keyword');
    });

    it('emits PSL_UNSUPPORTED_TOP_LEVEL_BLOCK when pslBlockDescriptors is omitted and keyword is unknown', () => {
      const schema = `
policy_select ReadPosts {
  target = Post
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe('PSL_UNSUPPORTED_TOP_LEVEL_BLOCK');
    });

    it('parses mixed built-in and extension blocks in the same namespace', () => {
      const schema = `
model Post {
  id Int @id
  title String
}

policy_select ReadPosts {
  target = Post
  as = permissive
  roles = [admin]
  using = "true"
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
        codecLookup: stubSqlExpressionCodecLookup,
      });

      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);

      const ns = result.ast.namespaces[0];
      expect(flatPslModels(result.ast)).toHaveLength(1);
      expect(flatPslModels(result.ast)[0]?.name).toBe('Post');

      const nsExtBlocks2 = namespacePslExtensionBlocks(ns!);
      expect(nsExtBlocks2).toHaveLength(1);
      expect(nsExtBlocks2[0]?.kind).toBe('test-policy-select');
      expect(nsExtBlocks2[0]?.name).toBe('ReadPosts');
    });

    it('built-in block parsing is unchanged when pslBlockDescriptors is provided', () => {
      const schema = `
model User {
  id Int @id
  email String @unique
}

enum Role {
  ADMIN
  EDITOR
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
      });

      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
      expect(flatPslModels(result.ast)).toHaveLength(1);
      expect(flatPslEnums(result.ast)).toHaveLength(1);
      expect(namespacePslExtensionBlocks(result.ast.namespaces[0]!)).toHaveLength(0);
    });

    it('lands extension blocks in the namespace extensionBlocks slot in source order', () => {
      const schema = `
model Model {
  id Int @id
}

policy_select Alpha {
  target = Model
  as = permissive
  roles = []
  using = "true"
}

policy_select Beta {
  target = Model
  as = restrictive
  roles = [admin]
  using = "false"
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
        codecLookup: stubSqlExpressionCodecLookup,
      });

      expect(result.ok).toBe(true);
      const ns = result.ast.namespaces[0];
      const extBlocks = namespacePslExtensionBlocks(ns!);
      expect(extBlocks).toHaveLength(2);
      expect(extBlocks[0]?.name).toBe('Alpha');
      expect(extBlocks[1]?.name).toBe('Beta');
    });

    it('captures unknown parameters as raw values and validation flags them', () => {
      const schema = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  as = permissive
  roles = []
  using = "true"
  unrecognized_param = some_value
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
        codecLookup: stubSqlExpressionCodecLookup,
      });

      // The validator runs after parsing and flags unknown parameters.
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toMatchObject([{ code: 'PSL_EXTENSION_UNKNOWN_PARAMETER' }]);
      // The parameter is still captured in the AST node.
      const block = namespacePslExtensionBlocks(result.ast.namespaces[0]!)[0];
      expect(block?.parameters['unrecognized_param']).toMatchObject({
        kind: 'value',
        raw: 'some_value',
      });
    });

    it('emits a diagnostic for a malformed body line (not key = value shaped)', () => {
      const schema = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  as = permissive
  roles = []
  using = "true"
  not_an_assignment
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
        codecLookup: stubSqlExpressionCodecLookup,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.code).toBe('PSL_INVALID_EXTENSION_BLOCK_MEMBER');
      expect(result.diagnostics[0]?.message).toContain('not_an_assignment');
    });

    it('parses extension block inside a named namespace', () => {
      const schema = `
namespace auth {
  model Post {
    id Int @id
  }

  policy_select ReadPosts {
    target = Post
    as = permissive
    roles = [admin]
    using = "true"
  }
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
        codecLookup: stubSqlExpressionCodecLookup,
      });

      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);

      const authNs = result.ast.namespaces.find((ns) => ns.name === 'auth');
      expect(authNs).toBeDefined();
      const authExtBlocks = namespacePslExtensionBlocks(authNs!);
      expect(authExtBlocks).toHaveLength(1);
      expect(authExtBlocks[0]?.name).toBe('ReadPosts');
    });

    it('parses an empty list parameter correctly', () => {
      const schema = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  as = permissive
  roles = []
  using = "true"
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
        codecLookup: stubSqlExpressionCodecLookup,
      });

      expect(result.ok).toBe(true);
      const block = namespacePslExtensionBlocks(result.ast.namespaces[0]!)[0];
      expect(block?.parameters['roles']).toMatchObject({
        kind: 'list',
        items: [],
      });
    });

    it('skips blank lines inside an extension block body', () => {
      const schema = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post

  as = permissive

  roles = [admin]
  using = "true"
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
        codecLookup: stubSqlExpressionCodecLookup,
      });

      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
      const block = namespacePslExtensionBlocks(result.ast.namespaces[0]!)[0];
      expect(Object.keys(block?.parameters ?? {})).toEqual(['target', 'as', 'roles', 'using']);
    });

    it('emits a diagnostic and drops the parameter for a list given a non-bracketed value', () => {
      const schema = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  as = permissive
  roles = admin
  using = "true"
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
        codecLookup: stubSqlExpressionCodecLookup,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toMatchObject([{ code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER' }]);
      expect(result.diagnostics[0]?.message).toContain('bracketed list');
      const block = namespacePslExtensionBlocks(result.ast.namespaces[0]!)[0];
      expect(block?.parameters['roles']).toBeUndefined();
    });

    it('skips empty segments in a list parameter', () => {
      const schema = `
model Post {
  id Int @id
}

policy_select ReadPosts {
  target = Post
  as = permissive
  roles = [admin, , editor]
  using = "true"
}
`;
      const result = parsePslDocument({
        schema,
        sourceId: 'schema.prisma',
        pslBlockDescriptors: { policy_select: policySelectDescriptor },
        codecLookup: stubSqlExpressionCodecLookup,
      });

      expect(result.ok).toBe(true);
      const block = namespacePslExtensionBlocks(result.ast.namespaces[0]!)[0];
      expect(block?.parameters['roles']).toMatchObject({
        kind: 'list',
        items: [
          { kind: 'ref', identifier: 'admin' },
          { kind: 'ref', identifier: 'editor' },
        ],
      });
    });
  });

  describe('colon-prefix field types (cross-contract-space)', () => {
    it('parses space:namespace.TypeName into typeContractSpaceId + typeNamespaceId + typeName', () => {
      const schema = `
model Profile {
  id Int @id
  user supabase:auth.User @relation(fields: [userId], references: [id])
  userId Int
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
      const profile = flatPslModels(result.ast).find((m) => m.name === 'Profile');
      const userField = profile?.fields.find((f) => f.name === 'user');
      expect(userField?.typeContractSpaceId).toBe('supabase');
      expect(userField?.typeNamespaceId).toBe('auth');
      expect(userField?.typeName).toBe('User');
    });

    it('parses space:TypeName (no namespace) into typeContractSpaceId + typeName (no typeNamespaceId)', () => {
      const schema = `
model Profile {
  id Int @id
  user supabase:User @relation(fields: [userId], references: [id])
  userId Int
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
      const profile = flatPslModels(result.ast).find((m) => m.name === 'Profile');
      const userField = profile?.fields.find((f) => f.name === 'user');
      expect(userField?.typeContractSpaceId).toBe('supabase');
      expect(userField?.typeNamespaceId).toBeUndefined();
      expect(userField?.typeName).toBe('User');
    });

    it('parses a colon-prefix optional list field correctly', () => {
      const schema = `
model Profile {
  id Int @id
  orgs supabase:auth.Organization[]
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      const profile = flatPslModels(result.ast).find((m) => m.name === 'Profile');
      const orgsField = profile?.fields.find((f) => f.name === 'orgs');
      expect(orgsField?.typeContractSpaceId).toBe('supabase');
      expect(orgsField?.typeNamespaceId).toBe('auth');
      expect(orgsField?.typeName).toBe('Organization');
      expect(orgsField?.list).toBe(true);
    });

    it('bare ns.Name is unchanged (no typeContractSpaceId)', () => {
      const schema = `
model Profile {
  id Int @id
  user auth.User @relation(fields: [userId], references: [id])
  userId Int
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      const profile = flatPslModels(result.ast).find((m) => m.name === 'Profile');
      const userField = profile?.fields.find((f) => f.name === 'user');
      expect(userField?.typeContractSpaceId).toBeUndefined();
      expect(userField?.typeNamespaceId).toBe('auth');
      expect(userField?.typeName).toBe('User');
    });

    it('bare Name is unchanged (no typeContractSpaceId, no typeNamespaceId)', () => {
      const schema = `
model Profile {
  id Int @id
  user User @relation(fields: [userId], references: [id])
  userId Int
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(true);
      const profile = flatPslModels(result.ast).find((m) => m.name === 'Profile');
      const userField = profile?.fields.find((f) => f.name === 'user');
      expect(userField?.typeContractSpaceId).toBeUndefined();
      expect(userField?.typeNamespaceId).toBeUndefined();
      expect(userField?.typeName).toBe('User');
    });

    it('rejects a:b:c (double colon) with a parse error', () => {
      const schema = `
model Foo {
  id Int @id
  bar a:b:c
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it('rejects a.b.c (triple dot) with PSL_INVALID_QUALIFIED_TYPE', () => {
      const schema = `
model Foo {
  id Int @id
  bar a.b.c
}
`;
      const result = parsePslDocument({ schema, sourceId: 'schema.prisma' });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe('PSL_INVALID_QUALIFIED_TYPE');
    });
  });
});
