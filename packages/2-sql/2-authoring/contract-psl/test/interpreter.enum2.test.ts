import type { Contract } from '@prisma-next/contract/types';
import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import { parsePslDocument } from '@prisma-next/psl-parser';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
  testEnumEntityContributions,
} from './fixtures';

// ---------------------------------------------------------------------------
// Minimal test codecs for enum2 validation
// ---------------------------------------------------------------------------

const textCodec: Codec = {
  id: 'pg/text@1',
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

const int4Codec: Codec = {
  id: 'pg/int4@1',
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'number') throw new Error(`expected number, got ${typeof json}`);
    return json;
  },
};

const testCodecLookup: CodecLookup = {
  get(id: string): Codec | undefined {
    if (id === 'pg/text@1') return textCodec;
    if (id === 'pg/int4@1') return int4Codec;
    return undefined;
  },
  targetTypesFor(id: string): readonly string[] | undefined {
    if (id === 'pg/text@1') return ['text'];
    if (id === 'pg/int4@1') return ['int4'];
    return undefined;
  },
  metaFor: () => undefined,
  renderOutputTypeFor: () => undefined,
};

const enum2PslBlockDescriptor = {
  kind: 'pslBlock' as const,
  keyword: 'enum2',
  discriminator: 'enum2',
  name: { required: true },
  parameters: {},
  variadicParameters: true,
};

const authoringContributions = {
  entityTypes: testEnumEntityContributions,
  field: {},
  type: {},
  pslBlockDescriptors: { enum2: enum2PslBlockDescriptor },
};

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

function interpret(schema: string, overrides?: Partial<InterpretPslDocumentToSqlContractInput>) {
  const contributions = overrides?.authoringContributions ?? authoringContributions;
  const descriptors = contributions.pslBlockDescriptors;
  const document = parsePslDocument({
    schema,
    sourceId: 'schema.prisma',
    ...(descriptors !== undefined ? { pslBlockDescriptors: descriptors } : {}),
  });
  return interpretPslDocumentToSqlContract({
    document,
    target: postgresTarget,
    scalarTypeDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    controlMutationDefaults: builtinControlMutationDefaults,
    authoringContributions: contributions,
    codecLookup: testCodecLookup,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// PSL ↔ TS parity: enum2 emits contract equal to TS enumType authoring
// ---------------------------------------------------------------------------

describe('enum2 PSL ↔ TS parity', () => {
  it('emits domain enum, storage valueSet, field/column valueSet refs, and table check equal to TS enumType authoring', () => {
    const pslResult = interpret(`
enum2 Priority {
  @@type("pg/text@1")
  Low    = "low"
  High   = "high"
  Urgent = "urgent"
}

model Post {
  id       Int    @id
  priority Priority
}
`);

    expect(pslResult.ok).toBe(true);
    if (!pslResult.ok) return;

    const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' as const };
    const PriorityHandle = enumType(
      'Priority',
      pgText,
      member('Low', 'low'),
      member('High', 'high'),
      member('Urgent', 'urgent'),
    );

    const sqlFamilyPack = {
      kind: 'family' as const,
      id: 'sql',
      familyId: 'sql' as const,
      version: '0.0.1',
    };
    const postgresTargetPack = {
      kind: 'target' as const,
      id: 'postgres',
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      version: '0.0.1',
      defaultNamespaceId: 'public',
    };

    const tsContract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      enums: { Priority: PriorityHandle },
      models: {
        Post: model('Post', {
          fields: {
            id: field.column({ codecId: 'pg/int4@1', nativeType: 'int4' }).id(),
            priority: field.namedType(PriorityHandle),
          },
        }).sql({ table: 'post' }),
      },
    });

    const pslNs = (pslResult.value.storage as unknown as SqlStorage).namespaces['public'];
    const tsNs = (tsContract.storage as unknown as SqlStorage).namespaces['public'];
    const pslDomainNs = pslResult.value.domain.namespaces['public'];
    const tsDomainNs = (tsContract as unknown as Contract).domain.namespaces['public'];

    expect(pslDomainNs?.enum?.['Priority']).toEqual(tsDomainNs?.enum?.['Priority']);
    expect(pslNs?.entries.valueSet?.['Priority']).toEqual(tsNs?.entries.valueSet?.['Priority']);
    expect(pslDomainNs?.models?.['Post']?.fields?.['priority']).toEqual(
      tsDomainNs?.models?.['Post']?.fields?.['priority'],
    );
    // Strict equality on the storage column catches extra properties (e.g. a stray typeRef).
    expect(pslNs?.entries.table?.['post']?.columns?.['priority']).toEqual(
      tsNs?.entries.table?.['post']?.columns?.['priority'],
    );
    expect(pslNs?.entries.table?.['post']?.checks).toEqual(tsNs?.entries.table?.['post']?.checks);
    // Both authoring paths must produce the same storageHash.
    expect((pslResult.value.storage as unknown as SqlStorage).storageHash).toEqual(
      (tsContract.storage as unknown as SqlStorage).storageHash,
    );
  });
});

// ---------------------------------------------------------------------------
// Diagnostic tests
// ---------------------------------------------------------------------------

describe('enum2 diagnostics', () => {
  it('missing @@type emits diagnostic', () => {
    const result = interpret(`
enum2 Priority {
  Low = "low"
}
model Post { id Int @id }
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_ENUM2_MISSING_TYPE' })]),
    );
  });

  it('unknown codec id emits diagnostic', () => {
    const result = interpret(`
enum2 Priority {
  @@type("unknown/codec@1")
  Low = "low"
}
model Post { id Int @id }
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_EXTENSION_INVALID_VALUE' })]),
    );
  });

  it('non-JSON member rawValue emits diagnostic', () => {
    const result = interpret(`
enum2 Priority {
  @@type("pg/text@1")
  Low = notjson
}
model Post { id Int @id }
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_EXTENSION_INVALID_VALUE' })]),
    );
  });

  it('codec-rejected member value emits diagnostic', () => {
    const result = interpret(`
enum2 Priority {
  @@type("pg/text@1")
  Low = 42
}
model Post { id Int @id }
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_EXTENSION_INVALID_VALUE' })]),
    );
  });

  it('bare member under non-string codec emits diagnostic', () => {
    const result = interpret(`
enum2 Priority {
  @@type("pg/int4@1")
  Low
}
model Post { id Int @id }
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_ENUM2_BARE_MEMBER_NON_STRING_CODEC' }),
      ]),
    );
  });

  it('duplicate member names emits PSL_EXTENSION_DUPLICATE_PARAMETER from the parser', () => {
    const result = interpret(`
enum2 Priority {
  @@type("pg/text@1")
  Low  = "low"
  Low  = "low2"
}
model Post { id Int @id }
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_EXTENSION_DUPLICATE_PARAMETER' }),
      ]),
    );
  });

  it('duplicate member values emits diagnostic', () => {
    const result = interpret(`
enum2 Priority {
  @@type("pg/text@1")
  Low  = "same"
  High = "same"
}
model Post { id Int @id }
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_ENUM2_DUPLICATE_MEMBER_VALUE' }),
      ]),
    );
  });

  it('enum2 name colliding with native enum name emits diagnostic', () => {
    const result = interpret(`
enum Priority {
  Low
}
enum2 Priority {
  @@type("pg/text@1")
  Low = "low"
}
model Post { id Int @id }
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_ENUM2_DUPLICATE_TYPE_NAME' })]),
    );
  });

  it('namespaced enum2 emits not-supported diagnostic', () => {
    const result = interpret(`
namespace public {
  enum2 Priority {
    @@type("pg/text@1")
    Low = "low"
  }
  model Post { id Int @id }
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_ENUM2_NAMESPACE_NOT_SUPPORTED' }),
      ]),
    );
  });

  it('missing enum2 entityType factory emits diagnostic for each enum2 block', () => {
    const entityTypesWithoutEnum2 = { enum: testEnumEntityContributions.enum };
    const result = interpret(
      `
enum2 Priority {
  @@type("pg/text@1")
  Low = "low"
}
model Post { id Int @id }
`,
      {
        authoringContributions: {
          entityTypes: entityTypesWithoutEnum2,
          field: {},
          type: {},
          pslBlockDescriptors: { enum2: enum2PslBlockDescriptor },
        },
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_ENUM2_MISSING_FACTORY' })]),
    );
  });

  it('missing pslBlockDescriptors means enum2 is treated as unknown top-level block', () => {
    const result = interpret(
      `
enum2 Priority {
  @@type("pg/text@1")
  Low = "low"
}
model Post { id Int @id }
`,
      {
        authoringContributions: {
          entityTypes: testEnumEntityContributions,
          field: {},
          type: {},
        },
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK' }),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Mixed document: native enum + enum2 side by side
// ---------------------------------------------------------------------------

describe('enum2 mixed document', () => {
  it('native enum and enum2 lower correctly side by side', () => {
    const nativeOnlyResult = interpret(`
enum Role {
  USER
  ADMIN
}

model User {
  id   Int  @id
  role Role
}
`);

    const mixedResult = interpret(`
enum Role {
  USER
  ADMIN
}

enum2 Priority {
  @@type("pg/text@1")
  Low    = "low"
  High   = "high"
}

model User {
  id       Int      @id
  role     Role
  priority Priority
}
`);

    expect(nativeOnlyResult.ok).toBe(true);
    expect(mixedResult.ok).toBe(true);
    if (!nativeOnlyResult.ok || !mixedResult.ok) return;

    const nativeNs = (nativeOnlyResult.value.storage as unknown as SqlStorage).namespaces['public'];
    const mixedNs = (mixedResult.value.storage as unknown as SqlStorage).namespaces['public'];

    expect(mixedNs?.entries.table?.['user']?.columns?.['role']).toMatchObject(
      nativeNs?.entries.table?.['user']?.columns?.['role'] as object,
    );
    expect(mixedNs?.entries.valueSet?.['Priority']).toMatchObject({
      kind: 'valueSet',
      values: ['low', 'high'],
    });
    const mixedDomainNs = mixedResult.value.domain.namespaces['public'];
    expect(mixedDomainNs?.enum?.['Priority']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Non-string codec happy path
// ---------------------------------------------------------------------------

describe('enum2 non-string codec', () => {
  it('integer-backed enum2 lowers correctly', () => {
    const result = interpret(`
enum2 Priority {
  @@type("pg/int4@1")
  Low  = 1
  High = 10
}

model Post {
  id       Int @id
  priority Priority
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = (result.value.storage as unknown as SqlStorage).namespaces['public'];
    expect(ns?.entries.valueSet?.['Priority']).toMatchObject({
      kind: 'valueSet',
      values: [1, 10],
    });
    const domainNs = result.value.domain.namespaces['public'];
    expect(domainNs?.enum?.['Priority']).toMatchObject({
      codecId: 'pg/int4@1',
      members: [
        { name: 'Low', value: 1 },
        { name: 'High', value: 10 },
      ],
    });
  });
});
