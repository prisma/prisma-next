/**
 * Branded model handles exported from
 * `@prisma-next/extension-better-auth/contract`:
 *
 * 1. Brand/coordinate assertions: each handle carries
 *    `spaceId: 'better-auth'`, the `public` namespace, its singular table
 *    name, and `refs.id` is a cross-space `TargetFieldRef` with the same
 *    coordinates.
 *
 * 2. Lowering smoke test: a `defineContract` fixture with
 *    `extensionPacks: { 'better-auth': betterAuthPack }`, a `Profile`
 *    model with `rel.belongsTo(User, …)` and
 *    `constraints.foreignKey(cols.userId, User.refs.id)` lowers to a
 *    storage `ForeignKeyReference` with `spaceId: 'better-auth'` +
 *    resolved `public`/`user`/`id`, and the cross-space relation appears
 *    in the contract domain.
 *
 * 3. Handle↔contract consistency: each handle agrees with the shipped
 *    `contract.json` on model name, namespace, table name, and the
 *    per-column codec ids — so drift between handles and the emitted
 *    space (including a column whose codec disagrees) is caught at
 *    test time.
 */
import type { FamilyPackRef, TargetPackRef } from '@prisma-next/framework-components/components';
import type { TargetFieldRef } from '@prisma-next/sql-contract-ts/contract-builder';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import { describe, expect, expectTypeOf, it } from 'vitest';
import contractJson from '../src/contract/contract.json' with { type: 'json' };
import { Account, Session, User, Verification } from '../src/exports/contract';
import betterAuthPack from '../src/exports/pack';

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

// ---------------------------------------------------------------------------
// 1. Brand / coordinate assertions
// ---------------------------------------------------------------------------

const HANDLES = [
  { handle: User, modelName: 'User', table: 'user' },
  { handle: Session, modelName: 'Session', table: 'session' },
  { handle: Account, modelName: 'Account', table: 'account' },
  { handle: Verification, modelName: 'Verification', table: 'verification' },
] as const;

describe('handle brands and coordinates', () => {
  for (const { handle, modelName, table } of HANDLES) {
    it(`${modelName} carries spaceId "better-auth", namespace "public", table "${table}"`, () => {
      expect(handle.spaceId).toBe('better-auth');
      expect(handle.stageOne.modelName).toBe(modelName);
      expect(handle.stageOne.namespace).toBe('public');
      expect(handle.tableName).toBe(table);
    });
  }

  it('User.refs.id is a cross-space TargetFieldRef branded "better-auth"', () => {
    expectTypeOf(User.refs.id).toEqualTypeOf<TargetFieldRef<'User', 'id', 'better-auth'>>();
    expect(User.refs.id.spaceId).toBe('better-auth');
    expect(User.refs.id.namespaceId).toBe('public');
    expect(User.refs.id.tableName).toBe('user');
  });

  it('Session.refs.id and Account.refs.id carry the brand at the type level', () => {
    expectTypeOf(Session.refs.id).toEqualTypeOf<TargetFieldRef<'Session', 'id', 'better-auth'>>();
    expectTypeOf(Account.refs.id).toEqualTypeOf<TargetFieldRef<'Account', 'id', 'better-auth'>>();
    expectTypeOf(Verification.refs.id).toEqualTypeOf<
      TargetFieldRef<'Verification', 'id', 'better-auth'>
    >();
  });
});

// ---------------------------------------------------------------------------
// 2. Lowering smoke test — FK + relation to User via the real pack
// ---------------------------------------------------------------------------

describe('lowering smoke test — FK + relation onto User via betterAuthPack', () => {
  function buildProfileContract() {
    const Profile = model('Profile', {
      fields: {
        id: field.column({ codecId: 'pg/text@1', nativeType: 'text', nullable: false }).id(),
        userId: field.column({ codecId: 'pg/text@1', nativeType: 'text', nullable: false }),
      },
      relations: {
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'profile',
      foreignKeys: [constraints.foreignKey(cols.userId, User.refs.id, { onDelete: 'cascade' })],
    }));

    return defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      extensionPacks: { 'better-auth': betterAuthPack },
      models: { Profile },
    });
  }

  it('lowers the FK with spaceId "better-auth", namespace "public", table "user", column "id"', () => {
    const contract = buildProfileContract();
    const profileTable = contract.storage.namespaces['public']!.entries.table?.['profile'];
    expect(profileTable).toBeDefined();
    const fks = profileTable?.foreignKeys;
    expect(fks).toHaveLength(1);
    const fk = fks![0]!;
    expect(fk.target.spaceId).toBe('better-auth');
    expect(fk.target.namespaceId).toBe('public');
    expect(fk.target.tableName).toBe('user');
    expect(fk.target.columns).toEqual(['id']);
  });

  it('cascade action passes through the FK', () => {
    const contract = buildProfileContract();
    const profileTable = contract.storage.namespaces['public']!.entries.table?.['profile'];
    expect(profileTable?.foreignKeys?.[0]?.onDelete).toBe('cascade');
  });

  it('the cross-space relation carries to.space "better-auth" / model "User"', () => {
    const contract = buildProfileContract();
    const profileDomain = contract.domain.namespaces['public']?.models['Profile'];
    expect(profileDomain).toBeDefined();
    const userRelation = profileDomain?.relations['user'] as Record<string, unknown> | undefined;
    expect(userRelation).toBeDefined();
    const to = userRelation?.['to'] as Record<string, unknown> | undefined;
    expect(to?.['space']).toBe('better-auth');
    expect(to?.['namespace']).toBe('public');
    expect(to?.['model']).toBe('User');
  });
});

// ---------------------------------------------------------------------------
// 3. Handle↔contract.json consistency
// ---------------------------------------------------------------------------

type ContractJsonDomain = {
  namespaces: Record<
    string,
    {
      models: Record<
        string,
        {
          fields: Record<string, { type: { codecId?: string } }>;
          storage: { table: string; fields: Record<string, unknown> };
        }
      >;
    }
  >;
};

/** Per-column codec-id map from a handle's field builders. */
function handleCodecIds(handle: (typeof HANDLES)[number]['handle']): Record<string, string> {
  return Object.fromEntries(
    Object.entries(handle.stageOne.fields).map(([name, builder]) => {
      const codecId = builder.build().descriptor?.codecId;
      if (codecId === undefined) {
        throw new Error(`handle field "${name}" carries no column descriptor codecId`);
      }
      return [name, codecId];
    }),
  );
}

/** Per-column codec-id map from the shipped contract.json domain model. */
function contractCodecIds(
  jsonModel: ContractJsonDomain['namespaces'][string]['models'][string],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(jsonModel.fields).map(([name, fieldDef]) => {
      const codecId = fieldDef.type.codecId;
      if (codecId === undefined) {
        throw new Error(`contract.json field "${name}" carries no codecId`);
      }
      return [name, codecId];
    }),
  );
}

describe('handle↔contract.json consistency', () => {
  const domain = contractJson.domain as unknown as ContractJsonDomain;

  for (const { handle, modelName } of HANDLES) {
    it(`${modelName} agrees with contract.json on namespace, table, and column codecs`, () => {
      const jsonModel = domain.namespaces['public']?.models[modelName];
      expect(jsonModel).toBeDefined();
      expect(handle.stageOne.modelName).toBe(modelName);
      expect(handle.tableName).toBe(jsonModel!.storage.table);
      // Whole-map equality: catches missing columns, extra columns, and
      // per-column codec drift in one assertion.
      expect(handleCodecIds(handle)).toEqual(contractCodecIds(jsonModel!));
    });
  }
});
