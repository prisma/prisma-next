import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/contract/framework-components';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';

type PortableSqlCodecTypes = {
  readonly 'pg/enum@1': { output: string };
  readonly 'sql/char@1': { output: string };
  readonly 'sql/text@1': { output: string };
  readonly 'sql/timestamp@1': { output: string };
};

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    field: {
      text: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sql/text@1',
          nativeType: 'text',
        },
      },
      timestamp: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sql/timestamp@1',
          nativeType: 'timestamp',
        },
      },
      createdAt: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sql/timestamp@1',
          nativeType: 'timestamp',
          default: {
            kind: 'function',
            expression: 'CURRENT_TIMESTAMP',
          },
        },
      },
      uuid: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sql/char@1',
          nativeType: 'character',
          typeParams: {
            length: 36,
          },
        },
      },
      ulid: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sql/char@1',
          nativeType: 'character',
          typeParams: {
            length: 26,
          },
        },
      },
      nanoid: {
        kind: 'fieldPreset',
        args: [
          {
            kind: 'object',
            optional: true,
            properties: {
              size: {
                kind: 'number',
                optional: true,
                integer: true,
                minimum: 2,
                maximum: 255,
              },
            },
          },
        ],
        output: {
          codecId: 'sql/char@1',
          nativeType: 'character',
          typeParams: {
            length: {
              kind: 'arg',
              index: 0,
              path: ['size'],
              default: 21,
            },
          },
        },
      },
      cuid2: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sql/char@1',
          nativeType: 'character',
          typeParams: {
            length: 24,
          },
        },
      },
      ksuid: {
        kind: 'fieldPreset',
        output: {
          codecId: 'sql/char@1',
          nativeType: 'character',
          typeParams: {
            length: 27,
          },
        },
      },
      id: {
        uuidv4: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sql/char@1',
            nativeType: 'character',
            typeParams: {
              length: 36,
            },
            executionDefault: {
              kind: 'generator',
              id: 'uuidv4',
            },
            id: true,
          },
        },
        uuidv7: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sql/char@1',
            nativeType: 'character',
            typeParams: {
              length: 36,
            },
            executionDefault: {
              kind: 'generator',
              id: 'uuidv7',
            },
            id: true,
          },
        },
        ulid: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sql/char@1',
            nativeType: 'character',
            typeParams: {
              length: 26,
            },
            executionDefault: {
              kind: 'generator',
              id: 'ulid',
            },
            id: true,
          },
        },
        nanoid: {
          kind: 'fieldPreset',
          args: [
            {
              kind: 'object',
              optional: true,
              properties: {
                size: {
                  kind: 'number',
                  optional: true,
                  integer: true,
                  minimum: 2,
                  maximum: 255,
                },
              },
            },
          ],
          output: {
            codecId: 'sql/char@1',
            nativeType: 'character',
            typeParams: {
              length: {
                kind: 'arg',
                index: 0,
                path: ['size'],
                default: 21,
              },
            },
            executionDefault: {
              kind: 'generator',
              id: 'nanoid',
              params: {
                size: {
                  kind: 'arg',
                  index: 0,
                  path: ['size'],
                },
              },
            },
            id: true,
          },
        },
        cuid2: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sql/char@1',
            nativeType: 'character',
            typeParams: {
              length: 24,
            },
            executionDefault: {
              kind: 'generator',
              id: 'cuid2',
            },
            id: true,
          },
        },
        ksuid: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sql/char@1',
            nativeType: 'character',
            typeParams: {
              length: 27,
            },
            executionDefault: {
              kind: 'generator',
              id: 'ksuid',
            },
            id: true,
          },
        },
      },
    },
    type: {
      enum: {
        kind: 'typeConstructor',
        args: [{ kind: 'string' }, { kind: 'stringArray' }],
        output: {
          codecId: 'pg/enum@1',
          nativeType: { kind: 'arg', index: 0 },
          typeParams: {
            values: { kind: 'arg', index: 1 },
          },
        },
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'postgres'> & {
  readonly __codecTypes?: PortableSqlCodecTypes;
};

const pgvectorExtensionPack = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    type: {
      pgvector: {
        vector: {
          kind: 'typeConstructor',
          args: [{ kind: 'number', integer: true, minimum: 1, maximum: 2000 }],
          output: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: {
              length: { kind: 'arg', index: 0 },
            },
          },
        },
      },
    },
  },
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

describe('refined option A helper vocabulary', () => {
  it('lowers portable scalar helpers and explicit uuidv4 primary keys', () => {
    const AuditEntry = model('AuditEntry', {
      fields: {
        id: field.id.uuidv4({ name: 'audit_entry_pkey' }),
        actorId: field.uuid().column('actor_id'),
        shortCode: field.nanoid({ size: 16 }).column('short_code'),
        email: field.text().unique({ name: 'audit_entry_email_key' }),
        createdAt: field.createdAt().column('created_at'),
        reviewedAt: field.timestamp().optional().column('reviewed_at'),
      },
    }).sql({
      table: 'audit_entry',
    });

    const contract = defineContract({
      target: postgresTargetPack,
      models: {
        AuditEntry,
      },
    });

    expect(contract.storage.tables.audit_entry.primaryKey).toEqual({
      columns: ['id'],
      name: 'audit_entry_pkey',
    });
    expect(contract.storage.tables.audit_entry.uniques).toEqual([
      {
        columns: ['email'],
        name: 'audit_entry_email_key',
      },
    ]);
    expect(contract.storage.tables.audit_entry.columns.id).toMatchObject({
      codecId: 'sql/char@1',
      nativeType: 'character',
      nullable: false,
      typeParams: { length: 36 },
    });
    expect(contract.storage.tables.audit_entry.columns.email).toMatchObject({
      codecId: 'sql/text@1',
      nativeType: 'text',
      nullable: false,
    });
    expect(contract.storage.tables.audit_entry.columns.short_code).toMatchObject({
      codecId: 'sql/char@1',
      nativeType: 'character',
      nullable: false,
      typeParams: { length: 16 },
    });
    expect(contract.storage.tables.audit_entry.columns.created_at).toMatchObject({
      codecId: 'sql/timestamp@1',
      nativeType: 'timestamp',
      nullable: false,
      default: {
        kind: 'function',
        expression: 'CURRENT_TIMESTAMP',
      },
    });
    expect(contract.storage.tables.audit_entry.columns.reviewed_at).toMatchObject({
      codecId: 'sql/timestamp@1',
      nativeType: 'timestamp',
      nullable: true,
    });
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { table: 'audit_entry', column: 'id' },
        onCreate: { kind: 'generator', id: 'uuidv4' },
      },
    ]);
    expect(contract.models.AuditEntry.fields.actorId).toEqual({ column: 'actor_id' });
  });

  it('preserves literal codec ids for portable field helpers and explicit id generators', () => {
    const textState = field.text().build();
    const timestampState = field.timestamp().build();
    const uuidState = field.uuid().build();
    const nanoidState = field.nanoid({ size: 16 }).build();
    const uuidV4IdState = field.id.uuidv4().build();
    const uuidV7IdState = field.id.uuidv7().build();
    const nanoidIdState = field.id.nanoid({ size: 16 }).build();

    expectTypeOf(textState.descriptor?.codecId).toEqualTypeOf<'sql/text@1' | undefined>();
    expectTypeOf(timestampState.descriptor?.codecId).toEqualTypeOf<'sql/timestamp@1' | undefined>();
    expectTypeOf(uuidState.descriptor?.codecId).toEqualTypeOf<'sql/char@1' | undefined>();
    expectTypeOf(nanoidState.descriptor?.codecId).toEqualTypeOf<'sql/char@1' | undefined>();
    expectTypeOf(uuidV4IdState.descriptor?.codecId).toEqualTypeOf<'sql/char@1' | undefined>();
    expectTypeOf(uuidV7IdState.descriptor?.codecId).toEqualTypeOf<'sql/char@1' | undefined>();
    expectTypeOf(nanoidIdState.descriptor?.codecId).toEqualTypeOf<'sql/char@1' | undefined>();

    expect(uuidState.descriptor?.typeParams).toEqual({ length: 36 });
    expect(nanoidState.descriptor?.typeParams).toEqual({ length: 16 });
    expect(uuidV4IdState.executionDefault).toEqual({ kind: 'generator', id: 'uuidv4' });
    expect(uuidV7IdState.executionDefault).toEqual({ kind: 'generator', id: 'uuidv7' });
    expect(nanoidIdState.executionDefault).toEqual({
      kind: 'generator',
      id: 'nanoid',
      params: { size: 16 },
    });
    expect(uuidV4IdState.id).toEqual({});
    expect(uuidV7IdState.id).toEqual({});
    expect(nanoidIdState.id).toEqual({});
  });

  it('supports trailing inline primary-key names on generated id helpers', () => {
    const ShortLink = model('ShortLink', {
      fields: {
        id: field.id.nanoid({ size: 16 }, { name: 'short_link_pkey' }),
        destination: field.text(),
      },
    }).sql({
      table: 'short_link',
    });

    const contract = defineContract({
      target: postgresTargetPack,
      models: {
        ShortLink,
      },
    });

    expect(contract.storage.tables.short_link.primaryKey).toEqual({
      columns: ['id'],
      name: 'short_link_pkey',
    });
    expect(contract.storage.tables.short_link.columns.id).toMatchObject({
      codecId: 'sql/char@1',
      nativeType: 'character',
      typeParams: { length: 16 },
    });
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { table: 'short_link', column: 'id' },
        onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
      },
    ]);
  });

  it('accepts named storage type refs from the local types object', () => {
    const types = {
      Role: {
        codecId: 'pg/enum@1',
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      },
    } as const;

    const User = model('User', {
      fields: {
        role: field.namedType(types.Role),
      },
    }).sql({
      table: 'app_user',
    });

    const contract = defineContract({
      target: postgresTargetPack,
      types,
      models: {
        User,
      },
    });

    expect(contract.storage.tables.app_user.columns.role).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'role',
      nullable: false,
      typeRef: 'Role',
    });
    expectTypeOf(contract.storage.tables.app_user.columns.role.typeRef).toEqualTypeOf<'Role'>();
  });

  it('warns when a string named type ref could use the local types object instead', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});

    try {
      const types = {
        Role: {
          codecId: 'pg/enum@1',
          nativeType: 'role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
      } as const;

      defineContract({
        target: postgresTargetPack,
        types,
        models: {
          User: model('User', {
            fields: {
              role: field.namedType('Role'),
            },
          }).sql({
            table: 'app_user',
          }),
        },
      });

      expect(emitWarning).toHaveBeenCalledWith(
        expect.stringContaining(`field.namedType('Role')`),
        expect.objectContaining({
          code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
        }),
      );
    } finally {
      emitWarning.mockRestore();
    }
  });

  it('does not warn when named storage types use the local types object directly', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});

    try {
      const types = {
        Role: {
          codecId: 'pg/enum@1',
          nativeType: 'role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
      } as const;

      defineContract({
        target: postgresTargetPack,
        types,
        models: {
          User: model('User', {
            fields: {
              role: field.namedType(types.Role),
            },
          }).sql({
            table: 'app_user',
          }),
        },
      });

      expect(emitWarning).not.toHaveBeenCalled();
    } finally {
      emitWarning.mockRestore();
    }
  });

  it('supports integrated contract callbacks with target-owned type helpers', () => {
    const contract = defineContract(
      {
        target: postgresTargetPack,
      },
      ({ type, field, model }) => {
        const types = {
          Role: type.enum('role', ['USER', 'ADMIN'] as const),
        } as const;

        return {
          types,
          models: {
            User: model('User', {
              fields: {
                role: field.namedType(types.Role),
              },
            }).sql({
              table: 'app_user',
            }),
          },
        };
      },
    );

    expect(contract.storage.types?.Role).toEqual({
      codecId: 'pg/enum@1',
      nativeType: 'role',
      typeParams: { values: ['USER', 'ADMIN'] },
    });
    expect(contract.storage.tables.app_user.columns.role).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'role',
      typeRef: 'Role',
    });
  });

  it('supports integrated contract callbacks with target-owned field presets', () => {
    const contract = defineContract(
      {
        target: postgresTargetPack,
      },
      ({ field, model }) => ({
        models: {
          AuditEntry: model('AuditEntry', {
            fields: {
              id: field.id.uuidv7().sql({ id: { name: 'audit_entry_pkey' } }),
              actorId: field.uuid().sql({ column: 'actor_id' }),
              email: field
                .text()
                .unique()
                .sql({ unique: { name: 'audit_entry_email_key' } }),
              createdAt: field.createdAt().sql({ column: 'created_at' }),
            },
          }).sql({
            table: 'audit_entry',
          }),
        },
      }),
    );

    expect(contract.storage.tables.audit_entry.primaryKey).toEqual({
      columns: ['id'],
      name: 'audit_entry_pkey',
    });
    expect(contract.storage.tables.audit_entry.uniques).toEqual([
      {
        columns: ['email'],
        name: 'audit_entry_email_key',
      },
    ]);
    expect(contract.storage.tables.audit_entry.columns.actor_id).toMatchObject({
      codecId: 'sql/char@1',
      nativeType: 'character',
      typeParams: { length: 36 },
    });
    expect(contract.storage.tables.audit_entry.columns.created_at.default).toEqual({
      kind: 'function',
      expression: 'CURRENT_TIMESTAMP',
    });
  });

  it('supports integrated contract callbacks with extension-owned type helpers', () => {
    const contract = defineContract(
      {
        target: postgresTargetPack,
        extensionPacks: {
          pgvector: pgvectorExtensionPack,
        },
      },
      ({ type, field, model }) => {
        const types = {
          Embedding1536: type.pgvector.vector(1536),
        } as const;

        return {
          types,
          models: {
            Document: model('Document', {
              fields: {
                embedding: field.namedType(types.Embedding1536),
              },
            }).sql({
              table: 'document',
            }),
          },
        };
      },
    );

    expect(contract.storage.types?.Embedding1536).toEqual({
      codecId: 'pg/vector@1',
      nativeType: 'vector',
      typeParams: { length: 1536 },
    });
    expect(contract.storage.tables.document.columns.embedding).toMatchObject({
      codecId: 'pg/vector@1',
      nativeType: 'vector',
      typeRef: 'Embedding1536',
    });
  });

  it('rejects duplicate authoring helper names across composed packs', () => {
    const conflictingPack = {
      kind: 'extension',
      id: 'conflicting-pack',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      authoring: {
        type: {
          enum: {
            kind: 'typeConstructor',
            args: [{ kind: 'string' }, { kind: 'stringArray' }],
            output: {
              codecId: 'conflict/enum@1',
              nativeType: { kind: 'arg', index: 0 },
              typeParams: {
                values: { kind: 'arg', index: 1 },
              },
            },
          },
        },
      },
    } as const satisfies ExtensionPackRef<'sql', 'postgres'>;

    expect(() =>
      defineContract(
        {
          target: postgresTargetPack,
          extensionPacks: {
            conflictingPack,
          },
        },
        () => ({
          models: {},
        }),
      ),
    ).toThrow(/Duplicate authoring type helper "enum"/);
  });

  it('rejects duplicate authoring field helper names across composed packs', () => {
    const conflictingPack = {
      kind: 'extension',
      id: 'conflicting-pack',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      authoring: {
        field: {
          text: {
            kind: 'fieldPreset',
            output: {
              codecId: 'conflict/text@1',
              nativeType: 'text',
            },
          },
        },
      },
    } as const satisfies ExtensionPackRef<'sql', 'postgres'>;

    expect(() =>
      defineContract(
        {
          target: postgresTargetPack,
          extensionPacks: {
            conflictingPack,
          },
        },
        () => ({
          models: {},
        }),
      ),
    ).toThrow(/Duplicate authoring field helper "text"/);
  });
});
