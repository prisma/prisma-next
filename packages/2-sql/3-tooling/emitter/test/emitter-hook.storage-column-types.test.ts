import { generateContractDts } from '@prisma-next/emitter';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

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
    // A storage column may reference a value-set even when no domain model field maps to it.
    // StorageColumnTypes must include it; FieldOutputTypes must NOT (A3).
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Audit: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'audit',
                  // 'action' column exists in storage but has no domain field.
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

    // StorageColumnTypes has the raw value-set column.
    expect(dts).toContain("readonly action: 'create' | 'update' | 'delete'");
    // FieldOutputTypes must NOT have 'action' (it has no domain field).
    // It only has 'id'.
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
});
