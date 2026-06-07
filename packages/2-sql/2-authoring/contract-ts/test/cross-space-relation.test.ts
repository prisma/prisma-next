/**
 * M2.2 — TS cross-space relation (Option B, non-navigable) + emitter
 *
 * Tests for cross-contract relation lowering:
 * - A cross-space `rel.belongsTo(ExtModel, …)` produces a domain relation whose
 *   `to.space` identifies the foreign contract space (CrossReference extended with `space?`)
 * - The relation still appears in the contract domain (introspectable)
 * - Missing-pack fail-fast for cross-space relations
 * - Local (same-space) relations are unchanged (no `to.space`)
 */
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model, rel } from '../src/contract-builder';
import { ContractModelBuilder } from '../src/contract-dsl';
import { modelsOf } from './contract-test-helpers';
import { columnDescriptor } from './helpers/column-descriptor';

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

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');

const supabasePack: ExtensionPackRef<'sql', 'postgres'> = {
  kind: 'extension',
  id: 'supabase',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

/**
 * Synthetic supabase AuthUser handle — same pattern as M2.1 cross-space FK tests.
 * M2.3 will produce this from the real extension package.
 */
function buildSyntheticSupabaseAuthUser() {
  return new ContractModelBuilder(
    {
      modelName: 'User' as const,
      namespace: 'auth',
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
      },
      relations: {},
    },
    undefined,
    undefined,
    'supabase' as const,
  ).sql({ table: 'users' });
}

// ---------------------------------------------------------------------------
// Cross-space relation lowering — CrossReference carries space
// ---------------------------------------------------------------------------

describe('cross-space belongsTo relation lowering', () => {
  it('the relation to.space identifies the foreign contract space', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    }).relations({
      user: rel.belongsTo(ExtUser, { from: 'userId', to: 'id' }),
    });

    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      extensionPacks: { supabase: supabasePack },
      models: { Profile },
    });

    const profileModel = modelsOf(contract)['Profile'];
    const userRelation = profileModel?.relations?.['user'] as Record<string, unknown> | undefined;
    expect(userRelation).toBeDefined();
    const to = userRelation?.['to'] as Record<string, unknown> | undefined;
    // CrossReference extended with `space?: string` carries the contract-space identity
    expect(to?.['space']).toBe('supabase');
  });

  it('the relation to.namespace reflects the target namespace', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    }).relations({
      user: rel.belongsTo(ExtUser, { from: 'userId', to: 'id' }),
    });

    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      extensionPacks: { supabase: supabasePack },
      models: { Profile },
    });

    const profileModel = modelsOf(contract)['Profile'];
    const userRelation = profileModel?.relations?.['user'] as Record<string, unknown> | undefined;
    const to = userRelation?.['to'] as Record<string, unknown> | undefined;
    // The namespace is 'auth' (from the handle's namespace coordinate)
    expect(to?.['namespace']).toBe('auth');
  });

  it('cross-space relation appears in contract domain (still present/introspectable)', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    }).relations({
      user: rel.belongsTo(ExtUser, { from: 'userId', to: 'id' }),
    });

    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      extensionPacks: { supabase: supabasePack },
      models: { Profile },
    });

    const profileModel = modelsOf(contract)['Profile'];
    // relation must exist in the domain
    expect(Object.keys(profileModel?.relations ?? {})).toContain('user');
  });

  it('on block carries the correct localFields and model name', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    }).relations({
      user: rel.belongsTo(ExtUser, { from: 'userId', to: 'id' }),
    });

    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      extensionPacks: { supabase: supabasePack },
      models: { Profile },
    });

    const profileModel = modelsOf(contract)['Profile'];
    const userRelation = profileModel?.relations?.['user'] as Record<string, unknown> | undefined;
    const on = userRelation?.['on'] as Record<string, unknown> | undefined;
    expect(on?.['localFields']).toEqual(['userId']);
    // Target field 'id' maps to column 'id' on the ext model
    expect(on?.['targetFields']).toEqual(['id']);
    const to = userRelation?.['to'] as Record<string, unknown> | undefined;
    expect(to?.['model']).toBe('User');
  });
});

// ---------------------------------------------------------------------------
// Cross-space relation — missing-pack fail-fast (AC5 TS half)
// ---------------------------------------------------------------------------

describe('cross-space belongsTo relation — missing-pack fail-fast', () => {
  it('throws when a cross-space relation references a space not in extensionPacks', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    }).relations({
      user: rel.belongsTo(ExtUser, { from: 'userId', to: 'id' }),
    });

    expect(() =>
      defineContract({
        family: bareFamilyPack,
        target: postgresTargetPack,
        // intentionally no extensionPacks — 'supabase' undeclared
        models: { Profile },
      }),
    ).toThrow(/supabase/);
  });

  it('error message mentions extensionPacks', () => {
    const ExtUser = buildSyntheticSupabaseAuthUser();

    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
    }).relations({
      user: rel.belongsTo(ExtUser, { from: 'userId', to: 'id' }),
    });

    expect(() =>
      defineContract({
        family: bareFamilyPack,
        target: postgresTargetPack,
        models: { Profile },
      }),
    ).toThrow(/extensionPacks/i);
  });
});

// ---------------------------------------------------------------------------
// Local relation regression (AC9) — local belongsTo stays unchanged
// ---------------------------------------------------------------------------

describe('local belongsTo relation regression (AC9)', () => {
  it('a local belongsTo relation has no to.space (byte-identical to pre-M2.2)', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
      },
    }).sql({ table: 'app_user' });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
        authorId: field.column(int4Column),
      },
    })
      .relations({
        author: rel.belongsTo(User, { from: 'authorId', to: 'id' }),
      })
      .sql({ table: 'post' });

    const contract = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      models: { User, Post },
    });

    const postModel = modelsOf(contract)['Post'];
    const authorRelation = postModel?.relations?.['author'] as Record<string, unknown> | undefined;
    expect(authorRelation).toBeDefined();
    const to = authorRelation?.['to'] as Record<string, unknown> | undefined;
    // Local relations must NOT have space
    expect(to).not.toHaveProperty('space');
  });
});
