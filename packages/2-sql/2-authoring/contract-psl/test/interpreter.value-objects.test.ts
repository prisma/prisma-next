import { parsePslDocument } from '@prisma-next/psl-parser';
import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  createTestNamespace,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  valueObjectsOf,
} from './fixtures';

describe('interpretPslDocumentToSqlContract value objects and list fields', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPslDocumentToSqlContract = (
    input: Omit<
      InterpretPslDocumentToSqlContractInput,
      'target' | 'scalarTypeDescriptors' | 'composedExtensionContracts'
    > &
      Partial<Pick<InterpretPslDocumentToSqlContractInput, 'composedExtensionContracts'>>,
  ) =>
    interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      scalarTypeDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestNamespace,
      ...input,
    });

  it('emits composite types as valueObjects', () => {
    const document = parsePslDocument({
      schema: `type Address {
  street String
  city String
  zip String?
}

model User {
  id Int @id
  name String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(valueObjectsOf(result.value)).toEqual({
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          zip: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        },
      },
    });
  });

  it('preserves the many marker for scalar list fields inside composite types', () => {
    const document = parsePslDocument({
      schema: `type Address {
  street String
  tags   String[]
}

model User {
  id Int @id
  home Address?
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(valueObjectsOf(result.value)).toEqual({
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          tags: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' }, many: true },
        },
      },
    });
  });

  it('emits value object field references with valueObject domain type and JSONB storage', () => {
    const document = parsePslDocument({
      schema: `type Address {
  street String
  city String
}

model User {
  id Int @id
  homeAddress Address?
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(modelsOf(result.value)).toMatchObject({
      User: {
        fields: {
          homeAddress: {
            nullable: true,
            type: { kind: 'valueObject', name: 'Address' },
          },
        },
      },
    });

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              user: {
                columns: {
                  homeAddress: {
                    nativeType: 'jsonb',
                    codecId: 'pg/jsonb@1',
                    nullable: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('emits scalar list fields with many: true', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  tags String[]
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(modelsOf(result.value)).toMatchObject({
      User: {
        fields: {
          tags: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: true,
          },
        },
      },
    });

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              user: {
                columns: {
                  tags: {
                    nativeType: 'jsonb',
                    codecId: 'pg/jsonb@1',
                    nullable: false,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('emits value object list fields with many: true and valueObject domain type', () => {
    const document = parsePslDocument({
      schema: `type Address {
  street String
  city String
}

model User {
  id Int @id
  addresses Address[]
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(modelsOf(result.value)).toMatchObject({
      User: {
        fields: {
          addresses: {
            nullable: false,
            type: { kind: 'valueObject', name: 'Address' },
            many: true,
          },
        },
      },
    });

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              user: {
                columns: {
                  addresses: {
                    nativeType: 'jsonb',
                    codecId: 'pg/jsonb@1',
                    nullable: false,
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('emits nested value object references within composite types', () => {
    const document = parsePslDocument({
      schema: `type Address {
  street String
  city String
}

type ShippingInfo {
  address Address
  notes String
}

model Order {
  id Int @id
  ship ShippingInfo
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(valueObjectsOf(result.value)).toEqual({
      Address: {
        fields: {
          street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        },
      },
      ShippingInfo: {
        fields: {
          address: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
          notes: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        },
      },
    });
  });

  it('omits valueObjects from contract when no composite types exist', () => {
    const document = parsePslDocument({
      schema: `model User {
  id Int @id
  name String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(valueObjectsOf(result.value)).toBeUndefined();
  });
});
