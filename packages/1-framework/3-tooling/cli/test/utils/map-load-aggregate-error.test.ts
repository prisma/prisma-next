/**
 * Unit coverage for `mapLoadAggregateError` — the CLI-side shim that
 * turns a structured `LoadAggregateError` into the user-facing
 * `CliStructuredError` envelope rendered by `db init`, `db update`,
 * `migration plan`, `migration status`, etc.
 *
 * The original implementation pointed every fix-hint at a non-existent
 * `prisma-next migrate` command. These tests pin the correct command
 * names per violation kind so the regression can't silently come back.
 */

import type { LoadAggregateError } from '@prisma-next/migration-tools/aggregate';
import { describe, expect, it } from 'vitest';
import { mapLoadAggregateError } from '../../src/utils/contract-space-aggregate-loader';

describe('mapLoadAggregateError', () => {
  it('layoutViolation: fix hint names `prisma-next migration plan` for declaredButUnmigrated and removal/re-declaration for orphanSpaceDir; never mentions `prisma-next migrate`', () => {
    const error: LoadAggregateError = {
      kind: 'layoutViolation',
      violations: [
        { kind: 'declaredButUnmigrated', spaceId: 'pgvector' },
        { kind: 'orphanSpaceDir', spaceId: 'feature-flags' },
      ],
    };

    const envelope = mapLoadAggregateError(error).toEnvelope();
    const fix = envelope.fix ?? '';

    expect(fix).toContain('prisma-next migration plan');
    expect(fix).toContain('declaredButUnmigrated');
    expect(fix).toContain('orphanSpaceDir');
    expect(fix).toContain('extensionPacks');
    expect(fix).not.toMatch(/\bprisma-next migrate\b/);
  });

  it('layoutViolation with only declaredButUnmigrated still names `prisma-next migration plan`', () => {
    const error: LoadAggregateError = {
      kind: 'layoutViolation',
      violations: [{ kind: 'declaredButUnmigrated', spaceId: 'pgvector' }],
    };
    const fix = mapLoadAggregateError(error).toEnvelope().fix ?? '';
    expect(fix).toContain('prisma-next migration plan');
    expect(fix).not.toMatch(/\bprisma-next migrate\b/);
  });

  it('integrityFailure fix hint names `prisma-next migration plan` rather than `prisma-next migrate`', () => {
    const error: LoadAggregateError = {
      kind: 'integrityFailure',
      spaceId: 'pgvector',
      detail: 'head ref hash does not match on-disk contract.json',
    };
    const fix = mapLoadAggregateError(error).toEnvelope().fix ?? '';
    expect(fix).toContain('prisma-next migration plan');
    expect(fix).not.toMatch(/\bprisma-next migrate\b/);
  });

  it('validationFailure fix hint names `prisma-next migration plan` rather than `prisma-next migrate`', () => {
    const error: LoadAggregateError = {
      kind: 'validationFailure',
      spaceId: 'pgvector',
      detail: 'contract failed arktype validation',
    };
    const fix = mapLoadAggregateError(error).toEnvelope().fix ?? '';
    expect(fix).toContain('prisma-next migration plan');
    expect(fix).not.toMatch(/\bprisma-next migrate\b/);
  });

  it('disjointnessViolation fix hint stays focused on contract editing (no command rename impact)', () => {
    const error: LoadAggregateError = {
      kind: 'disjointnessViolation',
      element: 'users',
      claimedBy: ['app', 'audit'],
    };
    const fix = mapLoadAggregateError(error).toEnvelope().fix ?? '';
    expect(fix).not.toMatch(/\bprisma-next migrate\b/);
  });

  it('targetMismatch fix hint stays focused on descriptor / adapter alignment (no command rename impact)', () => {
    const error: LoadAggregateError = {
      kind: 'targetMismatch',
      spaceId: 'pgvector',
      expected: 'postgres',
      actual: 'mongodb',
    };
    const fix = mapLoadAggregateError(error).toEnvelope().fix ?? '';
    expect(fix).not.toMatch(/\bprisma-next migrate\b/);
  });
});
