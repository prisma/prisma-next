import type { JsonValue } from '@prisma-next/contract/types';
import type {
  AuthoringEntityContext,
  AuthoringEntityTypeNamespace,
} from '@prisma-next/framework-components/authoring';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { PslExtensionBlock } from '@prisma-next/psl-parser';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToMongoContractInput,
  interpretPslDocumentToMongoContract,
} from '../src/interpreter';

// ---------------------------------------------------------------------------
// Minimal enum entity factory — mirrors mongoFamilyEnumEntityDescriptor
// ---------------------------------------------------------------------------

function parseQuotedString(raw: string): string | undefined {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) return raw.slice(1, -1);
  return undefined;
}

function testEnumFactory(block: PslExtensionBlock, ctx: AuthoringEntityContext) {
  const sourceId = ctx.sourceId ?? 'unknown';
  const diagnostics = ctx.diagnostics;

  const typeAttr = block.blockAttributes.find((a) => a.name === 'type');
  if (!typeAttr) {
    diagnostics?.push({
      code: 'PSL_ENUM_MISSING_TYPE',
      message: `enum "${block.name}" is missing a @@type("codecId") attribute`,
      sourceId,
      span: block.span,
    });
    return undefined;
  }

  const rawCodecArg = typeAttr.args[0]?.value;
  const codecId = rawCodecArg !== undefined ? parseQuotedString(rawCodecArg) : undefined;
  if (!codecId) {
    diagnostics?.push({
      code: 'PSL_ENUM_MISSING_TYPE',
      message: `enum "${block.name}" @@type attribute must have a quoted codec id argument`,
      sourceId,
      span: typeAttr.span,
    });
    return undefined;
  }

  const nativeType = ctx.codecLookup?.targetTypesFor(codecId)?.[0];
  if (nativeType === undefined) {
    diagnostics?.push({
      code: 'PSL_EXTENSION_INVALID_VALUE',
      message: `enum "${block.name}" @@type references unknown codec "${codecId}"`,
      sourceId,
      span: typeAttr.args[0]?.span ?? typeAttr.span,
    });
    return undefined;
  }

  const codec = ctx.codecLookup?.get(codecId);
  if (codec === undefined) return undefined;

  const members: { name: string; value: unknown }[] = [];
  for (const [memberName, paramValue] of Object.entries(block.parameters)) {
    if (paramValue.kind === 'bare') {
      members.push({ name: memberName, value: codec.decodeJson(memberName) });
    } else if (paramValue.kind === 'value') {
      const jsonValue = JSON.parse(paramValue.raw) as unknown;
      members.push({
        name: memberName,
        value: codec.decodeJson(
          blindCast<JsonValue, 'JSON.parse is JsonValue-compatible'>(jsonValue),
        ),
      });
    }
  }

  if (members.length === 0) return undefined;

  return {
    enumName: block.name,
    codecId,
    nativeType,
    enumMembers: members.map((m) => ({ name: m.name, value: m.value as JsonValue })),
  };
}

const testEnumEntityContributions: AuthoringEntityTypeNamespace = {
  enum: {
    kind: 'entity',
    discriminator: 'enum',
    output: { factory: testEnumFactory },
  },
};

const enumPslBlockDescriptor = {
  kind: 'pslBlock' as const,
  keyword: 'enum',
  discriminator: 'enum',
  name: { required: true },
  parameters: {},
  variadicParameters: true,
};

const authoringContributions = {
  entityTypes: testEnumEntityContributions,
  field: {},
  type: {},
  pslBlockDescriptors: { enum: enumPslBlockDescriptor },
};

const mongoScalarTypeDescriptors: ReadonlyMap<string, string> = new Map([
  ['ObjectId', 'mongo/objectId@1'],
  ['String', 'mongo/string@1'],
  ['Int', 'mongo/int32@1'],
]);

const mongoTargetTypes: Record<string, readonly string[]> = {
  'mongo/objectId@1': ['objectId'],
  'mongo/string@1': ['string'],
  'mongo/int32@1': ['int'],
};

const mongoCodecLookup: CodecLookup = {
  get(id: string) {
    const targetTypes = mongoTargetTypes[id];
    if (!targetTypes) return undefined;
    return {
      id,
      encode: async (v: unknown) => v,
      decode: async (w: unknown) => w,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => {
        if (id === 'mongo/string@1' && typeof j !== 'string')
          throw new Error(`expected string, got ${typeof j}`);
        return j;
      },
    } as ReturnType<CodecLookup['get']>;
  },
  targetTypesFor: (id: string) => mongoTargetTypes[id],
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

function interpret(
  schema: string,
  overrides?: Partial<Omit<InterpretPslDocumentToMongoContractInput, 'document'>>,
) {
  const contributions = overrides?.authoringContributions ?? authoringContributions;
  const descriptors = contributions?.pslBlockDescriptors;
  const document = parsePslDocument({
    schema,
    sourceId: 'test.prisma',
    ...(descriptors !== undefined ? { pslBlockDescriptors: descriptors } : {}),
  });
  return interpretPslDocumentToMongoContract({
    document,
    scalarTypeDescriptors: mongoScalarTypeDescriptors,
    codecLookup: mongoCodecLookup,
    authoringContributions: contributions,
    ...overrides,
  });
}

function interpretOk(
  schema: string,
  overrides?: Partial<Omit<InterpretPslDocumentToMongoContractInput, 'document'>>,
) {
  const result = interpret(schema, overrides);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected ok result');
  return result.value;
}

// ---------------------------------------------------------------------------
// PSL → contract round-trip
// ---------------------------------------------------------------------------

describe('PSL enum lowering', () => {
  it('lowers enum block to domain.namespaces[__unbound__].enum', () => {
    const contract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);

    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns).toBeDefined();
    const enumSlot = (ns as unknown as Record<string, unknown>)['enum'] as
      | Record<string, unknown>
      | undefined;
    expect(enumSlot).toBeDefined();
    expect(enumSlot?.['Role']).toEqual({
      codecId: 'mongo/string@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    });
  });

  it('stamps valueSet ref on the enum-typed field', () => {
    const contract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);

    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    const roleField = (ns?.models['Account'] as Record<string, unknown> | undefined)?.['fields'] as
      | Record<string, unknown>
      | undefined;
    expect(roleField?.['role']).toMatchObject({
      valueSet: {
        plane: 'domain',
        entityKind: 'enum',
        namespaceId: UNBOUND_NAMESPACE_ID,
        entityName: 'Role',
      },
    });
  });

  it('produces the same enum entity shape as the TS DSL (D1 parity)', () => {
    const pslContract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);

    const pslNs = pslContract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    const pslEnum = (pslNs as unknown as Record<string, unknown>)['enum'] as
      | Record<string, unknown>
      | undefined;

    // D1 TS DSL produces exactly this shape:
    expect(pslEnum?.['Role']).toEqual({
      codecId: 'mongo/string@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    });

    // D1 TS DSL stamps this exact valueSet on the field:
    const roleField = (
      (pslNs?.models['Account'] as Record<string, unknown> | undefined)?.['fields'] as
        | Record<string, unknown>
        | undefined
    )?.['role'] as Record<string, unknown> | undefined;

    expect(roleField?.['valueSet']).toEqual({
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityName: 'Role',
    });
  });

  it('enum field uses the enum codecId for its scalar type', () => {
    const contract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);

    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    const roleField = (
      (ns?.models['Account'] as Record<string, unknown> | undefined)?.['fields'] as
        | Record<string, unknown>
        | undefined
    )?.['role'] as Record<string, unknown> | undefined;

    expect(roleField?.['type']).toEqual({ kind: 'scalar', codecId: 'mongo/string@1' });
    expect(roleField?.['nullable']).toBe(false);
  });

  it('optional enum field is nullable', () => {
    const contract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role?
}
`);

    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    const roleField = (
      (ns?.models['Account'] as Record<string, unknown> | undefined)?.['fields'] as
        | Record<string, unknown>
        | undefined
    )?.['role'] as Record<string, unknown> | undefined;

    expect(roleField?.['nullable']).toBe(true);
    expect(roleField?.['valueSet']).toBeDefined();
  });

  it('fails when enum is missing @@type attribute', () => {
    const result = interpret(`
enum Role {
  User = "user"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.some((d) => d.code === 'PSL_ENUM_MISSING_TYPE')).toBe(true);
  });

  it('fails when enum references an unknown codec', () => {
    const result = interpret(`
enum Role {
  @@type("unknown/codec@1")
  User = "user"
}
model Account {
  id   ObjectId @id @map("_id")
  role Role
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.some((d) => d.code === 'PSL_EXTENSION_INVALID_VALUE')).toBe(
      true,
    );
  });

  it('non-enum fields are unaffected', () => {
    const contract = interpretOk(`
enum Role {
  @@type("mongo/string@1")
  User  = "user"
  Admin = "admin"
}
model Account {
  id    ObjectId @id @map("_id")
  name  String
  role  Role
}
`);

    const ns = contract.domain.namespaces[UNBOUND_NAMESPACE_ID];
    const fields = (ns?.models['Account'] as Record<string, unknown> | undefined)?.['fields'] as
      | Record<string, unknown>
      | undefined;

    const nameField = fields?.['name'] as Record<string, unknown> | undefined;
    expect(nameField?.['type']).toEqual({ kind: 'scalar', codecId: 'mongo/string@1' });
    expect(nameField?.['valueSet']).toBeUndefined();
  });
});
