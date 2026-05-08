/**
 * Pack-meta authoring contributions for the cipherstash extension.
 *
 * Pinned ACs (see `psl-encrypted-string-constructor.spec.md`):
 *   - AC-CTOR1 — pack-meta exposes `cipherstash.EncryptedString` as a
 *     namespaced `typeConstructor`.
 *   - AC-CTOR2 — single object argument with optional boolean
 *     `equality` and `freeTextSearch` properties.
 *   - AC-LOWER1 (shape) — output template lowers to a
 *     `ColumnTypeDescriptor` with `codecId: 'cipherstash/string@1'`,
 *     `nativeType: 'eql_v2_encrypted'`, and an `AuthoringArgRef`-based
 *     `typeParams` block carrying `false` defaults for both flags.
 *
 * Full PSL→ColumnTypeDescriptor lowering (AC-LOWER1..3, AC-CTOR3..4,
 * AC-ALIAS1..2) is exercised in `test/psl-interpretation.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { cipherstashAuthoringTypes } from '../src/core/authoring';
import cipherstashPack from '../src/exports/pack';

describe('cipherstash pack authoring contributions', () => {
  it('exposes cipherstash.EncryptedString as a namespaced type constructor (AC-CTOR1)', () => {
    expect(cipherstashPack.authoring?.type).toMatchObject({
      cipherstash: {
        EncryptedString: {
          kind: 'typeConstructor',
        },
      },
    });
  });

  it('declares a single object argument with optional equality + freeTextSearch boolean properties (AC-CTOR2)', () => {
    expect(cipherstashAuthoringTypes.cipherstash.EncryptedString).toMatchObject({
      kind: 'typeConstructor',
      args: [
        {
          kind: 'object',
          properties: {
            equality: { kind: 'boolean', optional: true },
            freeTextSearch: { kind: 'boolean', optional: true },
          },
        },
      ],
    });
  });

  it('lowers to ColumnTypeDescriptor with codecId cipherstash/string@1 + nativeType eql_v2_encrypted (AC-LOWER1 shape)', () => {
    expect(cipherstashAuthoringTypes.cipherstash.EncryptedString.output).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: {
        equality: { kind: 'arg', index: 0, path: ['equality'], default: false },
        freeTextSearch: {
          kind: 'arg',
          index: 0,
          path: ['freeTextSearch'],
          default: false,
        },
      },
    });
  });

  it('exposes the storage type registration via pack meta', () => {
    expect(cipherstashPack.types?.storage).toContainEqual({
      typeId: 'cipherstash/string@1',
      familyId: 'sql',
      targetId: 'postgres',
      nativeType: 'eql_v2_encrypted',
    });
  });
});
