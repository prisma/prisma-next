/**
 * Tests for entity-ref type constructors — the mechanism behind `pg.enum(Ref)`
 * native-enum field typing (see `@prisma-next/target-postgres`'s
 * `postgresAuthoringEntityRefTypeConstructors.pg.enum`).
 *
 * This file stays layer-isolated: it registers its own small `native_enum`-shaped
 * PSL block, entity type, and `entityRefTypeConstructor` rather than importing
 * `@prisma-next/target-postgres` (same rationale as `pgvectorAuthoringContributions`
 * in `fixtures.ts` — interpreter unit tests should not depend on a target pack).
 * Real-pack parity for `pg.enum(Ref)` itself lives in
 * `target-postgres/test/psl-pg-enum-column.test.ts`.
 */
import type {
  AuthoringContributions,
  AuthoringEntityRefTypeConstructorNamespace,
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockDescriptorNamespace,
  PslExtensionBlock,
} from '@prisma-next/framework-components/authoring';
import type { SqlEntityRefResolution } from '@prisma-next/sql-contract/entity-ref-resolution';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const NATIVE_ENUM_DISCRIMINATOR = 'test-native-enum';

const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  native_enum: {
    kind: 'pslBlock',
    keyword: 'native_enum',
    discriminator: NATIVE_ENUM_DISCRIMINATOR,
    name: { required: true },
    parameters: {},
    variadicParameters: true,
  },
};

function lowerTestNativeEnum(block: PslExtensionBlock): {
  readonly typeName: string;
  readonly members: readonly string[];
} {
  return { typeName: block.name, members: Object.keys(block.parameters) };
}

const entityTypes: AuthoringEntityTypeNamespace = {
  native_enum: {
    kind: 'entity',
    discriminator: NATIVE_ENUM_DISCRIMINATOR,
    output: { factory: lowerTestNativeEnum },
  },
};

function resolvePgEnumRef(
  ref: string,
  entities: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
  namespaceId?: string,
): SqlEntityRefResolution | undefined {
  const enums = entities?.[NATIVE_ENUM_DISCRIMINATOR];
  const entity = enums?.[ref] as { readonly typeName: string } | undefined;
  if (!entity) return undefined;
  const typeName =
    namespaceId !== undefined ? `${namespaceId}.${entity.typeName}` : entity.typeName;
  return {
    codecId: 'test/native-enum@1',
    nativeType: typeName,
    typeParams: { typeName },
    valueSetEntityName: ref,
  };
}

function resolvePlainRef(): SqlEntityRefResolution {
  return { codecId: 'test/plain-ref@1', nativeType: 'plain_ref' };
}

function resolveUnscopedValueSetRef(): SqlEntityRefResolution {
  return { codecId: 'test/native-enum@1', nativeType: 'unscoped', valueSetEntityName: 'Whatever' };
}

function resolveBrokenRef(): object {
  return { notCodecId: true, notNativeType: true };
}

const entityRefTypeConstructors: AuthoringEntityRefTypeConstructorNamespace = {
  pg: {
    enum: { kind: 'entityRefTypeConstructor', resolve: resolvePgEnumRef },
    plain: { kind: 'entityRefTypeConstructor', resolve: resolvePlainRef },
    always: { kind: 'entityRefTypeConstructor', resolve: resolveUnscopedValueSetRef },
    broken: { kind: 'entityRefTypeConstructor', resolve: resolveBrokenRef },
  },
};

const authoringContributions: AuthoringContributions = {
  entityTypes,
  entityRefTypeConstructors,
  pslBlockDescriptors,
};

const baseInput = {
  target: postgresTarget,
  scalarTypeDescriptors: postgresScalarTypeDescriptors,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

function interpretWith(schema: string) {
  const document = symbolTableInputFromParseArgs({
    schema,
    sourceId: 'schema.prisma',
    pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    ...baseInput,
    ...document,
    authoringContributions,
  });
}

describe('interpretPslDocumentToSqlContract entity-ref type constructors', () => {
  it('resolves a field entity-ref call to a column carrying a namespace-scoped valueSet ref', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
    aal2
    aal3
  }

  model AuthSession {
    id Int @id
    aal pg.enum(AalLevel)
  }
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      namespaces: {
        docs: {
          entries: {
            table: {
              authSession: {
                columns: {
                  aal: {
                    codecId: 'test/native-enum@1',
                    nativeType: 'docs.AalLevel',
                    typeParams: { typeName: 'docs.AalLevel' },
                    nullable: false,
                    valueSet: {
                      plane: 'storage',
                      entityKind: 'valueSet',
                      namespaceId: 'docs',
                      entityName: 'AalLevel',
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

  it('does not set a typeRef on an entity-ref-resolved column', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal pg.enum(AalLevel)
  }
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const namespaces = (
      result.value.storage as unknown as {
        namespaces: Record<
          string,
          { entries: { table: Record<string, { columns: Record<string, unknown> }> } }
        >;
      }
    ).namespaces;
    const column = namespaces['docs']?.entries.table['authSession']?.columns['aal'];
    expect(column).toMatchObject({ codecId: 'test/native-enum@1' });
    expect((column as { typeRef?: unknown } | undefined)?.typeRef).toBeUndefined();
  });

  it('leaves valueSet unset for an entity-ref resolution with no valueSetEntityName', () => {
    const result = interpretWith(`
namespace docs {
  model Thing {
    id Int @id
    ref pg.plain(AnyName)
  }
}
`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      namespaces: {
        docs: {
          entries: {
            table: {
              thing: {
                columns: {
                  ref: { codecId: 'test/plain-ref@1', nativeType: 'plain_ref' },
                },
              },
            },
          },
        },
      },
    });
  });

  it('rejects an unresolvable entity ref with PSL_UNKNOWN_ENTITY_REF', () => {
    const result = interpretWith(`
namespace docs {
  model AuthSession {
    id Int @id
    aal pg.enum(NoSuchEnum)
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_UNKNOWN_ENTITY_REF' })]),
    );
  });

  it('rejects an entity-ref call with no arguments', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal pg.enum()
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' })]),
    );
  });

  it('rejects an entity-ref call with more than one positional argument', () => {
    const result = interpretWith(`
namespace docs {
  native_enum AalLevel {
    aal1
  }

  model AuthSession {
    id Int @id
    aal pg.enum(AalLevel, Extra)
  }
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' })]),
    );
  });

  it('rejects a value-set-typed entity-ref resolution when the field has no resolvable namespace', () => {
    const result = interpretWith(`
type Broken {
  status pg.always(AnyRef)
}

model Placeholder {
  id Int @id
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('no resolvable namespace'),
        }),
      ]),
    );
  });

  it('throws when a contributed resolve() returns a payload that does not satisfy SqlEntityRefResolution', () => {
    expect(() =>
      interpretWith(`
type Broken {
  status pg.broken(AnyRef)
}

model Placeholder {
  id Int @id
}
`),
    ).toThrow(/does not satisfy SqlEntityRefResolution/);
  });
});
