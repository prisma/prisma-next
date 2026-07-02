/**
 * Tests for PSL `pg.enum(Ref)` field resolution:
 *
 *  1. A field `pg.enum(<native_enum ref>)` resolves the ref against the
 *     `native_enum` block declared in the same document (and namespace),
 *     lowering to a column `{ codecId: 'pg/enum@1', valueSet ref, nativeType,
 *     no CHECK }` — the production factory chain, no test-side hand-lowering.
 *
 *  2. Negatives: an unresolvable ref, and a ref naming something that is not
 *     a `native_enum` block.
 *
 *  3. Nullable variant (`pg.enum(E)?`).
 */

import { assembleAuthoringContributions } from '@prisma-next/framework-components/control';
import { buildSymbolTable } from '@prisma-next/psl-parser';
import { parse } from '@prisma-next/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityRefTypeConstructors,
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import type { PostgresSchema } from '../src/core/postgres-schema';
import { postgresCreateNamespace } from '../src/core/postgres-schema';

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      entityRefTypeConstructors: postgresAuthoringEntityRefTypeConstructors,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    },
  },
]);

const postgresTarget = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
};

const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
]);

function interpret(source: string) {
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    scalarTypes: [...scalarTypeDescriptors.keys()],
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: postgresTarget,
    scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
  });
}

const aalLevelSource = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")
  }

  model AuthSession {
    id  Int @id
    aal pg.enum(AalLevel)
  }
}
`;

describe('PSL pg.enum(Ref) field resolution', () => {
  it('lowers to a column with codecId pg/enum@1, a valueSet ref, and the enum typeName as nativeType', () => {
    const result = interpret(aalLevelSource);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const authTable = ns.table['authSession'];
    expect(authTable).toBeDefined();
    const aalColumn = authTable?.columns['aal'];
    expect(aalColumn).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'aal_level',
      nullable: false,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'auth',
        entityName: 'AalLevel',
      },
    });
    // No typeRef and no CHECK-strategy leftovers — a pg.enum column is a
    // plain value-set column, not a named-type-refined one.
    expect(aalColumn?.typeRef).toBeUndefined();
  });

  it('does not write a CHECK constraint for a pg.enum column', () => {
    const result = interpret(aalLevelSource);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const authTable = ns.table['authSession'];
    expect(authTable?.checks ?? []).toEqual([]);
  });

  it('resolves the enum for the value-set derived from the native_enum in the same namespace', () => {
    const result = interpret(aalLevelSource);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const valueSet = ns.valueSet?.['AalLevel'];
    expect(valueSet).toMatchObject({ values: ['aal1', 'aal2', 'aal3'] });
  });

  it('supports a nullable pg.enum(E)? field', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    @@map("aal_level")
  }

  model AuthSession {
    id  Int @id
    aal pg.enum(AalLevel)?
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const aalColumn = ns.table['authSession']?.columns['aal'];
    expect(aalColumn?.nullable).toBe(true);
    expect(aalColumn?.valueSet).toEqual({
      plane: 'storage',
      entityKind: 'valueSet',
      namespaceId: 'auth',
      entityName: 'AalLevel',
    });
  });

  it('resolves a pg.enum ref declared in the public namespace (the default target namespace)', () => {
    // A top-level (unspecified-namespace) `native_enum` block is never lowered
    // — native enums are schema-scoped and must be declared inside an explicit
    // `namespace { … }` block, same as any other native_enum. `namespace public
    // { … }` is the explicit way to target the default target namespace.
    const source = `
namespace public {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    @@map("aal_level")
  }

  model AuthSession {
    id  Int @id
    aal pg.enum(AalLevel)
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns.valueSet?.['AalLevel']).toMatchObject({ values: ['aal1', 'aal2'] });
    const aalColumn = ns.table['authSession']?.columns['aal'];
    expect(aalColumn).toMatchObject({
      codecId: 'pg/enum@1',
      nativeType: 'aal_level',
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'AalLevel',
      },
    });
  });
});

describe('PSL pg.enum(Ref) diagnostics', () => {
  it('an unresolvable ref is a diagnostic, not a silent fallback', () => {
    const source = `
namespace auth {
  model AuthSession {
    id  Int @id
    aal pg.enum(NoSuchEnum)
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_UNKNOWN_ENTITY_REF' })]),
    );
  });

  it('a ref naming something other than a native_enum block is a diagnostic', () => {
    const source = `
namespace auth {
  model AalLevel {
    id Int @id
  }

  model AuthSession {
    id  Int @id
    aal pg.enum(AalLevel)
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_UNKNOWN_ENTITY_REF' })]),
    );
  });

  it('a pg.enum() call with no arguments is a diagnostic', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    @@map("aal_level")
  }

  model AuthSession {
    id  Int @id
    aal pg.enum()
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' })]),
    );
  });
});
