import type { Contract } from '@prisma-next/contract/types';
import type {
  ContractSpaceAggregate,
  ContractSpaceMember,
} from '@prisma-next/migration-tools/aggregate';
import { describe, expect, it } from 'vitest';

import { validateFocusedSpaceOption } from '../../src/commands/migration-status';

const APP_HASH = `sha256:${'a'.repeat(64)}`;
const EXT_HASH = `sha256:${'b'.repeat(64)}`;

function makeMember(spaceId: string, hash: string): ContractSpaceMember {
  return {
    spaceId,
    contract: { storage: { storageHash: hash, tables: {} } } as unknown as Contract,
    headRef: { hash, invariants: [] },
    migrations: {
      graph: {
        nodes: new Set<string>(),
        forwardChain: new Map(),
        reverseChain: new Map(),
        migrationByHash: new Map(),
      },
      packagesByMigrationHash: new Map(),
    },
  };
}

function makeAggregate(extensions: readonly ContractSpaceMember[]): ContractSpaceAggregate {
  return {
    targetId: 'postgres',
    app: makeMember('app', APP_HASH),
    extensions,
  };
}

describe('validateFocusedSpaceOption', () => {
  it('returns ok for undefined space (app-space default)', () => {
    const result = validateFocusedSpaceOption({
      spaceOption: undefined,
      refName: undefined,
      aggregate: makeAggregate([makeMember('audit', EXT_HASH)]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.focusedSpaceId).toBe('app');
    }
  });

  it('returns ok for explicit --space app', () => {
    const result = validateFocusedSpaceOption({
      spaceOption: 'app',
      refName: undefined,
      aggregate: makeAggregate([makeMember('audit', EXT_HASH)]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.focusedSpaceId).toBe('app');
    }
  });

  it('returns ok for an extension id that exists in the aggregate', () => {
    const result = validateFocusedSpaceOption({
      spaceOption: 'audit',
      refName: undefined,
      aggregate: makeAggregate([makeMember('audit', EXT_HASH)]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.focusedSpaceId).toBe('audit');
    }
  });

  it('rejects an unknown space id; hint lists loaded space ids alphabetical, app last', () => {
    const aggregate = makeAggregate([
      makeMember('feature-flags', EXT_HASH),
      makeMember('audit', EXT_HASH),
    ]);
    const result = validateFocusedSpaceOption({
      spaceOption: 'nonexistent',
      refName: undefined,
      aggregate,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const env = result.failure.toEnvelope();
      expect(env.code).toBe('PN-CLI-5020');
      const fix = env.fix ?? '';
      expect(fix).toContain('audit');
      expect(fix).toContain('feature-flags');
      expect(fix).toContain('app');
      const auditIdx = fix.indexOf('audit');
      const featureIdx = fix.indexOf('feature-flags');
      const appIdx = fix.indexOf('app');
      expect(auditIdx).toBeLessThan(featureIdx);
      expect(featureIdx).toBeLessThan(appIdx);
    }
  });

  it('rejects --ref combined with a non-app --space', () => {
    const result = validateFocusedSpaceOption({
      spaceOption: 'audit',
      refName: 'production',
      aggregate: makeAggregate([makeMember('audit', EXT_HASH)]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.toEnvelope().code).toBe('PN-CLI-5021');
    }
  });

  it('accepts --ref combined with --space app (degenerate equivalence)', () => {
    const result = validateFocusedSpaceOption({
      spaceOption: 'app',
      refName: 'production',
      aggregate: makeAggregate([makeMember('audit', EXT_HASH)]),
    });
    expect(result.ok).toBe(true);
  });

  it('accepts --ref alone (no --space)', () => {
    const result = validateFocusedSpaceOption({
      spaceOption: undefined,
      refName: 'production',
      aggregate: makeAggregate([makeMember('audit', EXT_HASH)]),
    });
    expect(result.ok).toBe(true);
  });
});
