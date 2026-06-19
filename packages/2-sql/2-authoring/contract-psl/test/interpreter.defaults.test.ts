import { describe, expect, it } from 'vitest';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
  sqliteScalarTypeDescriptors,
  sqliteTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

describe('interpretPslDocumentToSqlContract default lowering', () => {
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
      ...input,
    });
  it('lowers supported default functions into execution and storage contract shapes', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Defaults {
  id Int @id
  idCuid2 String @default(cuid(2))
  idUuidV4 String @default(uuid())
  idUuidV7 String @default(uuid(7))
  idUlid String @default(ulid())
  idNanoidDefault String @default(nanoid())
  idNanoidSized String @default(nanoid(16))
  dbExpr String @default(dbgenerated("gen_random_uuid()"))
  createdAt DateTime @default(now())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: [
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idCuid2' },
            onCreate: { kind: 'generator', id: 'cuid2' },
          },
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idNanoidDefault' },
            onCreate: { kind: 'generator', id: 'nanoid' },
          },
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idNanoidSized' },
            onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
          },
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idUlid' },
            onCreate: { kind: 'generator', id: 'ulid' },
          },
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idUuidV4' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
          {
            ref: { namespace: 'public', table: 'defaults', column: 'idUuidV7' },
            onCreate: { kind: 'generator', id: 'uuidv7' },
          },
        ],
      },
    });
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              defaults: {
                columns: {
                  idNanoidDefault: {
                    codecId: 'sql/char@1',
                    nativeType: 'character',
                    typeParams: { length: 21 },
                  },
                  idNanoidSized: {
                    codecId: 'sql/char@1',
                    nativeType: 'character',
                    typeParams: { length: 16 },
                  },
                  dbExpr: {
                    default: {
                      kind: 'function',
                      expression: 'gen_random_uuid()',
                    },
                  },
                  createdAt: {
                    default: {
                      kind: 'function',
                      expression: 'now()',
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('accepts uuid() and uuid(7) defaults on @db.Uuid columns, preserving native uuid storage type', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  UuidNativeId = String @db.Uuid
}

model UuidNative {
  idV4 UuidNativeId @id @default(uuid())
  idV7 UuidNativeId @default(uuid(7))
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: expect.arrayContaining([
          {
            ref: { namespace: 'public', table: 'uuidNative', column: 'idV4' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
          {
            ref: { namespace: 'public', table: 'uuidNative', column: 'idV7' },
            onCreate: { kind: 'generator', id: 'uuidv7' },
          },
        ]),
      },
    });

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const uuidNativeTable = storage.namespaces['public']?.entries.table?.['uuidNative'];
    expect(uuidNativeTable?.columns['idV4']).toMatchObject({
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
    });
    expect(uuidNativeTable?.columns['idV7']).toMatchObject({
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
    });
  });

  it('accepts uuid() default on a named Uuid type field (e.g. id Uuid @id @default(uuid())), preserving native uuid storage type', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  Uuid = String @db.Uuid
}

model Profile {
  id Uuid @id @default(uuid())
  name String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: [
          {
            ref: { namespace: 'public', table: 'profile', column: 'id' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
        ],
      },
    });

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const profileTable = storage.namespaces['public']?.entries.table?.['profile'];
    expect(profileTable?.columns['id']).toMatchObject({
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
    });
  });

  it('rejects non-uuid generators on @db.Uuid columns with PSL_INVALID_DEFAULT_APPLICABILITY', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  UuidNativeId = String @db.Uuid
}

model UuidNativeBad {
  id UuidNativeId @id @default(nanoid())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('nanoid'),
        }),
      ]),
    );
  });

  it('returns diagnostics for unsupported default functions and invalid arguments', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model InvalidDefaults {
  id Int @id
  cuidValue String @default(cuid())
  badUuid String @default(uuid(5))
  badNanoid String @default(nanoid(1))
  emptyDbExpr String @default(dbgenerated(""))
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('cuid(2)'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('uuid'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('nanoid'),
        }),
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('dbgenerated'),
        }),
      ]),
    );
  });

  it('returns diagnostics for optional fields with execution defaults', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model OptionalDefaults {
  id Int @id
  token String? @default(nanoid())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining(
            'cannot be optional when using execution default "nanoid"',
          ),
        }),
      ]),
    );
  });

  it('preserves raw dbgenerated defaults for timestamp and json columns', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Defaults {
  id Int @id
  touchedAt DateTime @default(dbgenerated("clock_timestamp()"))
  payload Json @default(dbgenerated("'{}'::jsonb"))
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              defaults: {
                columns: {
                  touchedAt: {
                    default: {
                      kind: 'function',
                      expression: 'clock_timestamp()',
                    },
                  },
                  payload: {
                    default: {
                      kind: 'function',
                      expression: "'{}'::jsonb",
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  // The temporal preset registry inline test fixtures use to exercise the
  // PSL-side preset surface for Postgres + SQLite. Real targets ship the
  // same shapes via `target.authoring.field.temporal.{createdAt,updatedAt}`.
  const postgresTemporalContributions = {
    field: {
      temporal: {
        createdAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'pg/timestamptz@1',
            nativeType: 'timestamptz',
            default: { kind: 'function', expression: 'now()' },
          },
        },
        updatedAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'pg/timestamptz@1',
            nativeType: 'timestamptz',
            executionDefaults: {
              onCreate: { kind: 'generator', id: 'timestampNow' },
              onUpdate: { kind: 'generator', id: 'timestampNow' },
            },
          },
        },
      },
    },
  } as const;

  const sqliteTemporalContributions = {
    field: {
      temporal: {
        createdAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sqlite/datetime@1',
            nativeType: 'text',
            default: { kind: 'function', expression: 'now()' },
          },
        },
        updatedAt: {
          kind: 'fieldPreset',
          output: {
            codecId: 'sqlite/datetime@1',
            nativeType: 'text',
            executionDefaults: {
              onCreate: { kind: 'generator', id: 'timestampNow' },
              onUpdate: { kind: 'generator', id: 'timestampNow' },
            },
          },
        },
      },
    },
  } as const;

  it('lowers boolean literal defaults into the storage contract', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Flags {
  id Int @id
  enabled Boolean @default(true)
  disabled Boolean @default(false)
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['flags']?.columns['enabled']?.default).toEqual({
      kind: 'literal',
      value: true,
    });
    expect(unboundTables(storage)['flags']?.columns['disabled']?.default).toEqual({
      kind: 'literal',
      value: false,
    });
  });

  it('lowers temporal.updatedAt() to create and update execution defaults', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Timestamped {
  id Int @id
  createdAt DateTime @default(now())
  updatedAt temporal.updatedAt()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: postgresTemporalContributions,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['timestamped']?.columns['createdAt']?.default).toEqual({
      kind: 'function',
      expression: 'now()',
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', table: 'timestamped', column: 'updatedAt' },
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
    ]);
  });

  it('lowers SQLite temporal.updatedAt() to SQLite timestamp codecs', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Timestamped {
  id Int @id
  createdAt DateTime @default(now())
  updatedAt temporal.updatedAt()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractInternal({
      ...document,
      target: sqliteTarget,
      scalarTypeDescriptors: sqliteScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: sqliteTemporalContributions,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['timestamped']?.columns['updatedAt']).toMatchObject({
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
      nullable: false,
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: '__unbound__', table: 'timestamped', column: 'updatedAt' },
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
    ]);
  });

  it('emits a migration hint when @updatedAt is used (after attribute removal)', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Stale {
  id Int @id
  updatedAt DateTime @updatedAt
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('temporal.updatedAt()'),
        }),
      ]),
    );
  });

  it('suppresses the @updatedAt migration hint when the field already declares a temporal preset', () => {
    // `temporal.updatedAt() @updatedAt` is a half-migrated field. The
    // attribute is unsupported (no longer in BUILTIN_FIELD_ATTRIBUTE_NAMES),
    // so the diagnostic still fires — but we don't tell users to do what
    // they already did. The migration hint is suppressed; only the bare
    // unsupported-attribute message is emitted.
    const document = symbolTableInputFromParseArgs({
      schema: `model Migrated {
  id Int @id
  updatedAt temporal.updatedAt() @updatedAt
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: postgresTemporalContributions,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const updatedAtDiagnostic = result.failure.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE' &&
        diagnostic.message.includes('@updatedAt'),
    );
    expect(updatedAtDiagnostic).toBeDefined();
    expect(updatedAtDiagnostic?.message).not.toContain('temporal.updatedAt()');
  });

  it('resolves a synthetic field preset through the field-preset dispatch path (genericness)', () => {
    // Registers a synthetic preset under `temporal.exampleField` to confirm
    // that PSL's field-preset dispatch is generic — it walks
    // `authoringContributions.field` for any registered preset, not just the
    // real `temporal.{createdAt,updatedAt}` pair.
    const document = symbolTableInputFromParseArgs({
      schema: `model Synthetic {
  id Int @id
  example temporal.exampleField()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: {
        field: {
          temporal: {
            exampleField: {
              kind: 'fieldPreset',
              output: {
                codecId: 'pg/text@1',
                nativeType: 'text',
                default: { kind: 'function', expression: "'synthetic-default'" },
              },
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              synthetic: {
                columns: {
                  example: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
                    nullable: false,
                    default: {
                      kind: 'function',
                      expression: "'synthetic-default'",
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    // The synthetic preset declares a storage default only — no execution
    // mutation default should be emitted for the `example` column.
    const defaults = result.value.execution?.mutations.defaults ?? [];
    expect(defaults.find((entry) => entry.ref.column === 'example')).toBeUndefined();
  });

  it('uses nullable from field presets when lowering storage columns', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Synthetic {
  id Int @id
  maybe temporal.nullableField()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: {
        field: {
          temporal: {
            nullableField: {
              kind: 'fieldPreset',
              output: {
                codecId: 'pg/text@1',
                nativeType: 'text',
                nullable: true,
              },
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              synthetic: {
                columns: {
                  maybe: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
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

  it('resolves a type constructor sharing a field-preset namespace', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Synthetic {
  id Int @id
  example audit.Custom()
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
      authoringContributions: {
        field: {
          audit: {
            createdAt: {
              kind: 'fieldPreset',
              output: {
                codecId: 'pg/timestamptz@1',
                nativeType: 'timestamptz',
              },
            },
          },
        },
        type: {
          audit: {
            Custom: {
              kind: 'typeConstructor',
              output: {
                codecId: 'pg/text@1',
                nativeType: 'text',
              },
            },
          },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              synthetic: {
                columns: {
                  example: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  // Field-preset misuse cases. The preset is a complete field declaration —
  // optional (?), list ([]), @default(...), @id, @updatedAt all contradict
  // that and produce hard errors per spec FR7.
  describe('field-preset misuse', () => {
    const syntheticPresetContributions = {
      field: {
        temporal: {
          exampleField: {
            kind: 'fieldPreset',
            output: {
              codecId: 'pg/text@1',
              nativeType: 'text',
              default: { kind: 'function', expression: "'synthetic-default'" },
            },
          },
        },
      },
    } as const;

    it('rejects optional field-preset call with PSL_PRESET_NOT_OPTIONAL', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.exampleField()?
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_PRESET_NOT_OPTIONAL',
            sourceId: 'schema.prisma',
          }),
        ]),
      );
    });

    it('rejects field-preset call combined with @default(...) with PSL_PRESET_AND_DEFAULT_CONFLICT', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.exampleField() @default(now())
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_PRESET_AND_DEFAULT_CONFLICT',
            sourceId: 'schema.prisma',
          }),
        ]),
      );
    });

    it('rejects field-preset call combined with @id when preset does not contribute id', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.exampleField() @id
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_PRESET_AND_ID_CONFLICT',
            sourceId: 'schema.prisma',
          }),
        ]),
      );
    });

    it('rejects an unknown extension namespace in field-position with PSL_EXTENSION_NAMESPACE_NOT_COMPOSED (AC5c)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  ts weather.updatedAt()
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
            sourceId: 'schema.prisma',
            data: { namespace: 'weather', suggestedPack: 'weather' },
          }),
        ]),
      );
    });

    it('rejects extra positional argument to a zero-arg preset (AC5a)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.exampleField(123)
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
            sourceId: 'schema.prisma',
            message: expect.stringContaining('temporal.exampleField'),
          }),
        ]),
      );
    });

    it('rejects list-of preset call with PSL_PRESET_NOT_LIST (AC5f)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.exampleField()[]
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: syntheticPresetContributions,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_PRESET_NOT_LIST',
            sourceId: 'schema.prisma',
          }),
        ]),
      );
    });

    it('rejects @default(temporal.updatedAt()) with PSL_INVALID_DEFAULT_VALUE (AC5g)', () => {
      // Namespaced calls inside @default(...) are not supported — the
      // default-function parser only accepts bare identifiers. The honest
      // rejection path is "this isn't a valid @default(...) value", not
      // "this generator isn't applicable". Locks in which diagnostic fires.
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  ts DateTime @default(temporal.updatedAt())
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_INVALID_DEFAULT_VALUE',
            sourceId: 'schema.prisma',
            message: expect.stringContaining('temporal.updatedAt()'),
          }),
        ]),
      );
    });

    it('rejects two type-constructor calls on the same field at parse time (AC5i)', () => {
      // PSL grammar permits at most one type-constructor call per field; a
      // second one is a parser-level reject. This test locks in the
      // failure mode so a future parser refactor can't silently accept the
      // ambiguous form and let the interpreter pick one.
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example temporal.updatedAt() temporal.createdAt()
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics.length).toBeGreaterThan(0);
    });

    it('rejects an unknown preset name in a registered field namespace with PSL_UNKNOWN_FIELD_PRESET', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Bad {
  id Int @id
  example audit.foo()
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        authoringContributions: { field: { audit: {} }, type: {} },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_UNKNOWN_FIELD_PRESET',
            sourceId: 'schema.prisma',
            message: expect.stringContaining('audit.foo'),
            data: { namespace: 'audit', helperPath: 'audit.foo' },
          }),
        ]),
      );
    });
  });
});
