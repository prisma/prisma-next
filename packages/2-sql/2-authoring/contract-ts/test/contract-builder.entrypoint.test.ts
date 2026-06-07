import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import {
  freezeNode,
  type IRNode,
  type Namespace,
  NamespaceBase,
} from '@prisma-next/framework-components/ir';
import type { SqlNamespaceTablesInput } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';

class StubNamespace extends NamespaceBase {
  readonly kind = 'schema' as const;
  readonly id: string;
  readonly entries = Object.freeze({
    table: Object.freeze({}) as Readonly<Record<string, IRNode>>,
  });

  constructor(id: string) {
    super();
    this.id = id;
    freezeNode(this);
  }

  qualifier(): string {
    return `"${this.id}"`;
  }

  qualifyTable(name: string): string {
    return `"${this.id}"."${name}"`;
  }
}

function createStubNamespace(input: SqlNamespaceTablesInput): Namespace {
  return new StubNamespace(input.id);
}

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const documentFamilyPack = {
  kind: 'family',
  id: 'document',
  familyId: 'document',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'document'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const pgvectorExtensionPack = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

const mysqlExtensionPack = {
  ...pgvectorExtensionPack,
  targetId: 'mysql',
} as const satisfies ExtensionPackRef<'sql', 'mysql'>;

function unsafeExtensionPackRefForRuntimeTest<FamilyId extends string, TargetId extends string>(
  pack: FamilyPackRef<string> | TargetPackRef<string, string> | ExtensionPackRef<string, string>,
): ExtensionPackRef<FamilyId, TargetId> {
  // These runtime-guard tests intentionally bypass the static pack-ref contract so they can
  // assert the error paths for invalid inputs that well-typed authoring code cannot produce.
  return pack as unknown as ExtensionPackRef<FamilyId, TargetId>;
}

describe('defineContract runtime guards', () => {
  it.each([
    {
      name: 'non-SQL family packs',
      run: () =>
        defineContract({
          family: documentFamilyPack,
          target: postgresTargetPack,
          models: {},
        }),
      error: 'defineContract only accepts SQL family packs. Received family "document".',
    },
    {
      name: 'non-extension pack refs in extensionPacks',
      run: () =>
        defineContract({
          family: sqlFamilyPack,
          target: postgresTargetPack,
          extensionPacks: {
            invalid: unsafeExtensionPackRefForRuntimeTest(postgresTargetPack),
          },
          models: {},
        }),
      error:
        'defineContract only accepts extension pack refs in extensionPacks. Received kind "target".',
    },
    {
      name: 'extension packs from another family',
      run: () =>
        defineContract({
          family: sqlFamilyPack,
          target: postgresTargetPack,
          extensionPacks: {
            invalid: unsafeExtensionPackRefForRuntimeTest({
              ...pgvectorExtensionPack,
              familyId: 'document',
            }),
          },
          models: {},
        }),
      error:
        'extension pack "pgvector" targets family "document" but contract target family is "sql".',
    },
    {
      name: 'extension packs for another target',
      run: () =>
        defineContract({
          family: sqlFamilyPack,
          target: postgresTargetPack,
          extensionPacks: {
            invalid: mysqlExtensionPack,
          },
          models: {},
        }),
      error: 'extension pack "pgvector" targets "mysql" but contract target is "postgres".',
    },
  ])('rejects $name', ({ run, error }) => {
    expect(run).toThrow(error);
  });
});

describe('defineContract namespace declaration runtime guards', () => {
  const sqliteTargetPack = {
    kind: 'target',
    id: 'sqlite',
    familyId: 'sql',
    targetId: 'sqlite',
    version: '0.0.1',
    defaultNamespaceId: '__unbound__',
  } as const satisfies TargetPackRef<'sql', 'sqlite'>;

  it('accepts an empty namespaces list and treats it as no-op', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: [],
        models: {},
      }),
    ).not.toThrow();
  });

  it('accepts user-declared Postgres schema names with or without a `createNamespace` factory', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['public', 'auth'],
        createNamespace: createStubNamespace,
        models: {},
      }),
    ).not.toThrow();

    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['public', 'auth'],
        models: {},
      }),
    ).not.toThrow();
  });

  it('rejects the reserved IR sentinel `__unbound__` in the declared namespaces list', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['__unbound__'],
        models: {},
      }),
    ).toThrow(/__unbound__.*reserved/i);
  });

  it('rejects the reserved parser-synthesised sentinel `__unspecified__` in the declared namespaces list', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['__unspecified__'],
        models: {},
      }),
    ).toThrow(/__unspecified__.*reserved/i);
  });

  it('rejects Postgres-specific reserved keyword `unbound` in the declared namespaces list', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['unbound'],
        models: {},
      }),
    ).toThrow(/unbound.*reserved.*Postgres|Postgres.*unbound.*reserved/i);
  });

  it('rejects duplicate namespace names', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['auth', 'public', 'auth'],
        models: {},
      }),
    ).toThrow(/duplicate.*auth/i);
  });

  it('rejects empty / whitespace-only namespace names', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: [''],
        models: {},
      }),
    ).toThrow(/empty/i);

    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        namespaces: ['   '],
        models: {},
      }),
    ).toThrow(/whitespace|empty/i);
  });

  it('on SQLite, rejects any non-empty namespaces list (SQLite has no schema concept)', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: sqliteTargetPack,
        namespaces: ['auth'],
        models: {},
      }),
    ).toThrow(/SQLite/);
  });

  it('on SQLite, accepts an empty namespaces list (the no-op default)', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: sqliteTargetPack,
        namespaces: [],
        models: {},
      }),
    ).not.toThrow();
  });
});
