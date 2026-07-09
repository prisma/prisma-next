import type { AuthoringEntityTypeFactoryOutput } from '@prisma-next/framework-components/authoring';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import { freezeNode, IRNodeBase } from '@prisma-next/framework-components/ir';
import type { SqlValueSetDerivingEntityTypeOutput } from '@prisma-next/sql-contract/value-set-derivation-hook';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { defineContract } from '../src/contract-builder';

/**
 * TML-2965 (native-enum-ts-authoring): a generic, namespace-scoped
 * pack-entity attachment through `defineContract`. `contract-ts` names no
 * specific entity kind, so this test stands up a synthetic pack entity that
 * mirrors the shape of Postgres's real `native_enum` (a value-set-deriving
 * entity registered under `AuthoringContributions.entityTypes`) without
 * depending on the postgres target package — `contract-ts` (sql/authoring)
 * cannot import from the targets domain (see architecture.config.json).
 */

interface TestNativeEnumInput {
  readonly typeName: string;
  readonly members: readonly string[];
}

class TestNativeEnum extends IRNodeBase {
  readonly kind = 'test-native-enum' as const;
  readonly typeName: string;
  readonly members: readonly string[];

  constructor(input: TestNativeEnumInput) {
    super();
    this.typeName = input.typeName;
    this.members = Object.freeze([...input.members]);
    freezeNode(this);
  }
}

// Mirrors the real Postgres `nativeEnumEntityTypeOutput` shape
// (packages/3-targets/3-targets/postgres/src/core/authoring.ts): checked
// against the intersection type standalone so the entity-types map's
// `satisfies AuthoringEntityTypeNamespace` check doesn't trip an
// excess-property error over the extra `deriveValueSet` hook.
const nativeEnumEntityTypeOutput = {
  factory: (input: TestNativeEnumInput): TestNativeEnum => new TestNativeEnum(input),
  deriveValueSet: (entity: TestNativeEnum) => ({
    kind: 'valueSet' as const,
    values: [...entity.members],
  }),
} satisfies AuthoringEntityTypeFactoryOutput<TestNativeEnumInput, TestNativeEnum> &
  SqlValueSetDerivingEntityTypeOutput;

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const nativeEnumExtensionPack = {
  kind: 'extension',
  id: 'native-enum-demo',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    entityTypes: {
      native_enum: {
        kind: 'entity',
        discriminator: 'native_enum',
        output: nativeEnumEntityTypeOutput,
      },
    },
  },
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

describe('generic pack-entity attachment (packEntities)', () => {
  it('lands an attached entity under entries.<kind> and its derived value-set under entries.valueSet, in the default namespace', () => {
    const aalLevel = new TestNativeEnum({
      typeName: 'aal_level',
      members: ['aal1', 'aal2', 'aal3'],
    });

    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      extensionPacks: { nativeEnumDemo: nativeEnumExtensionPack },
      packEntities: {
        public: { native_enum: { AalLevel: aalLevel } },
      },
    });

    const publicNamespace = contract.storage.namespaces['public'];
    expect(publicNamespace?.entries).toEqual({
      table: {},
      native_enum: { AalLevel: aalLevel },
      valueSet: { AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2', 'aal3'] } },
    });
  });

  it('lands an attached entity under entries.<kind> and its derived value-set under entries.valueSet, in a named namespace', () => {
    const publicAalLevel = new TestNativeEnum({
      typeName: 'aal_level',
      members: ['aal1', 'aal2'],
    });
    const authAalLevel = new TestNativeEnum({
      typeName: 'aal_level',
      members: ['aal1', 'aal2', 'aal3'],
    });

    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      namespaces: ['auth'],
      extensionPacks: { nativeEnumDemo: nativeEnumExtensionPack },
      packEntities: {
        public: { native_enum: { AalLevel: publicAalLevel } },
        auth: { native_enum: { AalLevel: authAalLevel } },
      },
    });

    const publicNamespace = contract.storage.namespaces['public'];
    const authNamespace = contract.storage.namespaces['auth'];

    expect(publicNamespace?.entries).toEqual({
      table: {},
      native_enum: { AalLevel: publicAalLevel },
      valueSet: { AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2'] } },
    });
    expect(authNamespace?.entries).toEqual({
      table: {},
      native_enum: { AalLevel: authAalLevel },
      valueSet: { AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2', 'aal3'] } },
    });
  });

  it('rejects a pack entity declared under a framework-managed entry kind (table/valueSet)', () => {
    expect(() =>
      defineContract({
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        extensionPacks: { nativeEnumDemo: nativeEnumExtensionPack },
        packEntities: {
          public: { table: {} },
        },
      }),
    ).toThrow(/entry kind "table"/);
  });
});
