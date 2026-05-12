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

  describe('cipherstash.EncryptedDouble', () => {
    it('exposes EncryptedDouble as a namespaced type constructor', () => {
      expect(cipherstashPack.authoring?.type).toMatchObject({
        cipherstash: { EncryptedDouble: { kind: 'typeConstructor' } },
      });
    });

    it('declares { equality, orderAndRange } booleans, defaulting both to true', () => {
      expect(cipherstashAuthoringTypes.cipherstash.EncryptedDouble).toMatchObject({
        kind: 'typeConstructor',
        args: [
          {
            kind: 'object',
            optional: true,
            properties: {
              equality: { kind: 'boolean', optional: true },
              orderAndRange: { kind: 'boolean', optional: true },
            },
          },
        ],
      });
      expect(cipherstashAuthoringTypes.cipherstash.EncryptedDouble.output).toMatchObject({
        codecId: 'cipherstash/double@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: {
          equality: { kind: 'arg', index: 0, path: ['equality'], default: true },
          orderAndRange: { kind: 'arg', index: 0, path: ['orderAndRange'], default: true },
        },
      });
    });

    it('registers the cipherstash/double@1 storage type', () => {
      expect(cipherstashPack.types?.storage).toContainEqual({
        typeId: 'cipherstash/double@1',
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'eql_v2_encrypted',
      });
    });
  });

  describe('cipherstash.EncryptedBigInt', () => {
    it('exposes EncryptedBigInt as a namespaced type constructor', () => {
      expect(cipherstashPack.authoring?.type).toMatchObject({
        cipherstash: { EncryptedBigInt: { kind: 'typeConstructor' } },
      });
    });

    it('lowers to ColumnTypeDescriptor with codecId cipherstash/bigint@1, defaulting both flags to true', () => {
      expect(cipherstashAuthoringTypes.cipherstash.EncryptedBigInt.output).toMatchObject({
        codecId: 'cipherstash/bigint@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: {
          equality: { kind: 'arg', index: 0, path: ['equality'], default: true },
          orderAndRange: { kind: 'arg', index: 0, path: ['orderAndRange'], default: true },
        },
      });
    });

    it('registers the cipherstash/bigint@1 storage type', () => {
      expect(cipherstashPack.types?.storage).toContainEqual({
        typeId: 'cipherstash/bigint@1',
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'eql_v2_encrypted',
      });
    });
  });

  describe('cipherstash.EncryptedDate', () => {
    it('exposes EncryptedDate as a namespaced type constructor', () => {
      expect(cipherstashPack.authoring?.type).toMatchObject({
        cipherstash: { EncryptedDate: { kind: 'typeConstructor' } },
      });
    });

    it('lowers to ColumnTypeDescriptor with codecId cipherstash/date@1, defaulting both flags to true', () => {
      expect(cipherstashAuthoringTypes.cipherstash.EncryptedDate.output).toMatchObject({
        codecId: 'cipherstash/date@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: {
          equality: { kind: 'arg', index: 0, path: ['equality'], default: true },
          orderAndRange: { kind: 'arg', index: 0, path: ['orderAndRange'], default: true },
        },
      });
    });

    it('registers the cipherstash/date@1 storage type', () => {
      expect(cipherstashPack.types?.storage).toContainEqual({
        typeId: 'cipherstash/date@1',
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'eql_v2_encrypted',
      });
    });
  });

  describe('cipherstash.EncryptedBoolean', () => {
    it('exposes EncryptedBoolean as a namespaced type constructor', () => {
      expect(cipherstashPack.authoring?.type).toMatchObject({
        cipherstash: { EncryptedBoolean: { kind: 'typeConstructor' } },
      });
    });

    it('lowers to ColumnTypeDescriptor with codecId cipherstash/boolean@1, defaulting equality to true', () => {
      expect(cipherstashAuthoringTypes.cipherstash.EncryptedBoolean.output).toMatchObject({
        codecId: 'cipherstash/boolean@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: {
          equality: { kind: 'arg', index: 0, path: ['equality'], default: true },
        },
      });
    });

    it('registers the cipherstash/boolean@1 storage type', () => {
      expect(cipherstashPack.types?.storage).toContainEqual({
        typeId: 'cipherstash/boolean@1',
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'eql_v2_encrypted',
      });
    });
  });

  describe('cipherstash.EncryptedJson', () => {
    it('exposes EncryptedJson as a namespaced type constructor', () => {
      expect(cipherstashPack.authoring?.type).toMatchObject({
        cipherstash: { EncryptedJson: { kind: 'typeConstructor' } },
      });
    });

    it('lowers to ColumnTypeDescriptor with codecId cipherstash/json@1, defaulting searchableJson to true', () => {
      expect(cipherstashAuthoringTypes.cipherstash.EncryptedJson.output).toMatchObject({
        codecId: 'cipherstash/json@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: {
          searchableJson: { kind: 'arg', index: 0, path: ['searchableJson'], default: true },
        },
      });
    });

    it('registers the cipherstash/json@1 storage type', () => {
      expect(cipherstashPack.types?.storage).toContainEqual({
        typeId: 'cipherstash/json@1',
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'eql_v2_encrypted',
      });
    });
  });
});
