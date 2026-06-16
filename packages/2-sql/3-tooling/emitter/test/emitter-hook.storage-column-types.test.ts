import { generateContractDts } from '@prisma-next/emitter';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

function vectorCodecLookup(): CodecLookup {
  return {
    get: () => undefined,
    targetTypesFor: () => undefined,
    metaFor: () => undefined,
    renderOutputTypeFor: (id, params) =>
      id === 'pg/vector@1' ? `Vector<${params['length']}>` : undefined,
    renderInputTypeFor: (id, params) =>
      id === 'pg/vector@1' ? `VectorInput<${params['length']}>` : undefined,
  };
}

describe('StorageColumnTypes', () => {
  it('emits a literal union entry for an enum column (text codec)', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Post: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'post',
                  fields: { priority: { column: 'priority' } },
                },
                fields: {
                  priority: {
                    nullable: false,
                    type: { kind: 'scalar', codecId: 'pg/text@1' },
                    valueSet: {
                      plane: 'domain',
                      entityKind: 'enum',
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      entityName: 'Priority',
                    },
                  },
                },
                relations: {},
              },
            },
            enum: {
              Priority: {
                codecId: 'pg/text@1',
                members: [
                  { name: 'Low', value: 'low' },
                  { name: 'High', value: 'high' },
                  { name: 'Urgent', value: 'urgent' },
                ],
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    priority: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityName: 'Priority',
                      },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                Priority: { kind: 'valueSet', values: ['low', 'high', 'urgent'] },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    expect(dts).toContain('export type StorageColumnTypes =');
    // The column entry must be a plain literal union — no ContractBase[...] expression.
    expect(dts).toContain("readonly priority: 'low' | 'high' | 'urgent'");
    expect(dts).not.toContain('ContractBase[');
    expect(dts).not.toContain("['members'][number]");
  });

  it('emits a codec output entry for a non-enum column', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              User: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'user',
                  fields: { email: { column: 'email' } },
                },
                fields: {
                  email: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    expect(dts).toContain('export type StorageColumnTypes =');
    // Non-enum column: codec output access.
    expect(dts).toContain("readonly email: CodecTypes['pg/text@1']['output']");
  });

  it('emits a literal union for a numeric-codec (int) enum column', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Item: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'item',
                  fields: { level: { column: 'level' } },
                },
                fields: {
                  level: {
                    nullable: false,
                    type: { kind: 'scalar', codecId: 'pg/int4@1' },
                    valueSet: {
                      plane: 'domain',
                      entityKind: 'enum',
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      entityName: 'Level',
                    },
                  },
                },
                relations: {},
              },
            },
            enum: {
              Level: {
                codecId: 'pg/int4@1',
                members: [
                  { name: 'Beginner', value: 1 },
                  { name: 'Advanced', value: 2 },
                ],
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                item: {
                  columns: {
                    level: {
                      nativeType: 'int4',
                      codecId: 'pg/int4@1',
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityName: 'Level',
                      },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                Level: { kind: 'valueSet', values: [1, 2] },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    expect(dts).toContain('readonly level: 1 | 2');
    // Must be plain literals, not a codec reference or ContractBase expression.
    expect(dts).not.toContain('ContractBase[');
  });

  it('emits the __unbound__ namespace in StorageColumnTypes', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Tag: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'tag',
                  fields: { name: { column: 'name' } },
                },
                fields: {
                  name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                tag: {
                  columns: {
                    name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    expect(dts).toContain('export type StorageColumnTypes =');
    // __unbound__ is a valid identifier so serializeObjectKey does not quote it.
    expect(dts).toContain(`readonly ${UNBOUND_NAMESPACE_ID}:`);
  });

  it('includes a value-set column with no domain field in StorageColumnTypes (raw value-set case)', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Audit: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'audit',
                  fields: { id: { column: 'id' } },
                },
                fields: {
                  id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                audit: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                    action: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityName: 'AuditAction',
                      },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                AuditAction: { kind: 'valueSet', values: ['create', 'update', 'delete'] },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    expect(dts).toContain("readonly action: 'create' | 'update' | 'delete'");
    const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({[\s\S]*?});/);
    expect(fieldOutputMatch).not.toBeNull();
    const fieldOutputBlock = fieldOutputMatch![0];
    expect(fieldOutputBlock).not.toContain('action');
    expect(fieldOutputBlock).toContain('id');
  });

  it('derives FieldOutputTypes enum entry as plain literal union from StorageColumnTypes (A4)', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Post: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'post',
                  fields: { priority: { column: 'priority' } },
                },
                fields: {
                  priority: {
                    nullable: false,
                    type: { kind: 'scalar', codecId: 'pg/text@1' },
                    valueSet: {
                      plane: 'domain',
                      entityKind: 'enum',
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      entityName: 'Priority',
                    },
                  },
                },
                relations: {},
              },
            },
            enum: {
              Priority: {
                codecId: 'pg/text@1',
                members: [
                  { name: 'Low', value: 'low' },
                  { name: 'High', value: 'high' },
                  { name: 'Urgent', value: 'urgent' },
                ],
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    priority: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityName: 'Priority',
                      },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                Priority: { kind: 'valueSet', values: ['low', 'high', 'urgent'] },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    // FieldOutputTypes must show the plain literal union, not a ContractBase expression.
    expect(dts).toContain("readonly priority: 'low' | 'high' | 'urgent'");
    expect(dts).not.toContain('ContractBase[');
    expect(dts).not.toContain("['members'][number]");
  });

  it('bakes the parameterized-codec-refined type for a typeRef column (not the raw accessor)', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Post: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'post',
                  fields: { embedding: { column: 'embedding' } },
                },
                fields: {
                  embedding: {
                    nullable: true,
                    type: { kind: 'scalar', codecId: 'pg/vector@1' },
                  },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    embedding: {
                      nativeType: 'vector',
                      codecId: 'pg/vector@1',
                      nullable: true,
                      typeRef: 'Embedding1536',
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
        types: {
          Embedding1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      vectorCodecLookup(),
    );

    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch).not.toBeNull();
    // The refined codec output is baked in, NOT the raw codec accessor.
    expect(storageColumnMatch![0]).toContain('readonly embedding: Vector<1536> | null');
    expect(storageColumnMatch![0]).not.toContain("CodecTypes['pg/vector@1']['output']");
  });

  it('emits a StorageColumnInputTypes map (param-refined input side)', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Post: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'post',
                  fields: { embedding: { column: 'embedding' }, title: { column: 'title' } },
                },
                fields: {
                  embedding: { nullable: false, type: { kind: 'scalar', codecId: 'pg/vector@1' } },
                  title: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    embedding: {
                      nativeType: 'vector',
                      codecId: 'pg/vector@1',
                      nullable: false,
                      typeRef: 'Embedding1536',
                    },
                    title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
        types: {
          Embedding1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      vectorCodecLookup(),
    );

    const inputMatch = dts.match(/export type StorageColumnInputTypes = ({.+?});/s);
    expect(inputMatch).not.toBeNull();
    // Refined input render for the parameterized column; codec input accessor for the plain one.
    expect(inputMatch![0]).toContain('readonly embedding: VectorInput<1536>');
    expect(inputMatch![0]).toContain("readonly title: CodecTypes['pg/text@1']['input']");
  });

  it('narrows StorageColumnInputTypes to the value-set union for an enum column', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Post: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'post',
                  fields: { priority: { column: 'priority' } },
                },
                fields: {
                  priority: {
                    nullable: false,
                    type: { kind: 'scalar', codecId: 'pg/text@1' },
                    valueSet: {
                      plane: 'domain',
                      entityKind: 'enum',
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      entityName: 'Priority',
                    },
                  },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    priority: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityName: 'Priority',
                      },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                Priority: { kind: 'valueSet', values: ['low', 'high', 'urgent'] },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    const inputMatch = dts.match(/export type StorageColumnInputTypes = ({.+?});/s);
    expect(inputMatch).not.toBeNull();
    expect(inputMatch![0]).toContain("readonly priority: 'low' | 'high' | 'urgent'");
  });

  it('FieldOutputTypes uses the field element codec for a many[] field, not the storage column codec', () => {
    const contract = createContract({
      models: {
        Config: {
          storage: {
            table: 'config',
            fields: { tags: { column: 'tags' } },
          },
          fields: {
            tags: {
              nullable: false,
              many: true,
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          config: {
            columns: {
              tags: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false },
            },
            primaryKey: { columns: ['tags'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({.+?});/s);
    expect(fieldOutputMatch).not.toBeNull();
    expect(fieldOutputMatch![0]).toContain(
      "readonly tags: ReadonlyArray<CodecTypes['pg/text@1']['output']>",
    );
    expect(fieldOutputMatch![0]).not.toContain('jsonb');

    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch).not.toBeNull();
    expect(storageColumnMatch![0]).toContain("readonly tags: CodecTypes['pg/jsonb@1']['output']");
  });
});
