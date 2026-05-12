/**
 * Pack-meta authoring contributions for the cipherstash extension.
 *
 * Pinned behaviour:
 *   - Pack-meta exposes `cipherstash.EncryptedString` as a namespaced
 *     `typeConstructor`.
 *   - The constructor takes a single OPTIONAL object argument with
 *     optional boolean `equality` and `freeTextSearch` properties (so
 *     `cipherstash.EncryptedString()` and `cipherstash.EncryptedString({})`
 *     both parse).
 *   - The output template lowers to a `ColumnTypeDescriptor` with
 *     `codecId: 'cipherstash/string@1'`, `nativeType: 'eql_v2_encrypted'`,
 *     and an `AuthoringArgRef`-based `typeParams` block carrying
 *     `true` defaults for both flags — searchable encryption is the
 *     legitimate default; users opt out explicitly.
 *
 * Full PSL→ColumnTypeDescriptor lowering is exercised in
 * `test/psl-interpretation.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { cipherstashAuthoringTypes } from '../src/contract-authoring';
import cipherstashPack from '../src/exports/pack';

describe('cipherstash pack authoring contributions', () => {
  it('exposes cipherstash.EncryptedString as a namespaced type constructor', () => {
    expect(cipherstashPack.authoring?.type).toMatchObject({
      cipherstash: {
        EncryptedString: {
          kind: 'typeConstructor',
        },
      },
    });
  });

  it('declares a single optional object argument with optional equality + freeTextSearch boolean properties', () => {
    expect(cipherstashAuthoringTypes.cipherstash.EncryptedString).toMatchObject({
      kind: 'typeConstructor',
      args: [
        {
          kind: 'object',
          optional: true,
          properties: {
            equality: { kind: 'boolean', optional: true },
            freeTextSearch: { kind: 'boolean', optional: true },
          },
        },
      ],
    });
  });

  it('lowers to ColumnTypeDescriptor with codecId cipherstash/string@1 + nativeType eql_v2_encrypted, defaulting both flags to true', () => {
    expect(cipherstashAuthoringTypes.cipherstash.EncryptedString.output).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: {
        equality: { kind: 'arg', index: 0, path: ['equality'], default: true },
        freeTextSearch: {
          kind: 'arg',
          index: 0,
          path: ['freeTextSearch'],
          default: true,
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
