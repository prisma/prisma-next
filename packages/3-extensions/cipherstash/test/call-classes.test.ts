/**
 * Cipherstash migration IR call classes — T1.4.
 *
 * Each `*Call` is a renderable node implementing the framework
 * `OpFactoryCall` interface. The class carries the literal arguments its
 * backing factory would receive, computes a human-readable `label` in its
 * constructor, and exposes:
 *
 *   - `toOp()` — produces the runtime op shape that the codec hook used
 *     to build via `buildAddOp` / `buildRemoveOp`. Byte-equality with the
 *     pre-CR-1 op shape is the round-trip invariant
 *     (`examples/cipherstash-integration/.../ops.json` is captured
 *     pre-change and must remain identical).
 *   - `renderTypeScript()` — emits a `cipherstashAddSearchConfig({...})`
 *     / `cipherstashRemoveSearchConfig({...})` factory call so the
 *     generated `migration.ts` reads as a normal authored migration.
 *   - `importRequirements()` — declares the factory symbol pulled from
 *     `@prisma-next/extension-cipherstash/migration`.
 */

import { describe, expect, it } from 'vitest';
import {
  CipherstashAddSearchConfigCall,
  CipherstashRemoveSearchConfigCall,
  type CipherstashSearchIndex,
  cipherstashAddSearchConfig,
  cipherstashRemoveSearchConfig,
} from '../src/migration/call-classes';

const TABLE = 'user';
const FIELD = 'email';
const MIGRATION_MODULE = '@prisma-next/extension-cipherstash/migration';

describe('CipherstashAddSearchConfigCall', () => {
  it('exposes factoryName, operationClass and label per (table, field, index)', () => {
    const call = new CipherstashAddSearchConfigCall(TABLE, FIELD, 'unique');
    expect(call.factoryName).toBe('cipherstashAddSearchConfig');
    expect(call.operationClass).toBe('additive');
    expect(call.label).toBe(`Register cipherstash search config (unique) for ${TABLE}.${FIELD}`);
  });

  it('toOp() produces the canonical add_search_config@v1 op shape', () => {
    const call = new CipherstashAddSearchConfigCall(TABLE, FIELD, 'unique');
    expect(call.toOp()).toEqual({
      id: `cipherstash-codec.${TABLE}.${FIELD}.add-search-config.unique`,
      label: `Register cipherstash search config (unique) for ${TABLE}.${FIELD}`,
      operationClass: 'additive',
      invariantId: `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:unique@v1`,
      target: { id: 'postgres' },
      precheck: [],
      execute: [
        {
          description: `Register cipherstash unique search config for ${TABLE}.${FIELD}`,
          sql: `SELECT eql_v2.add_search_config('${TABLE}', '${FIELD}', 'unique', 'text');`,
        },
      ],
      postcheck: [],
    });
  });

  it("toOp() embeds 'match' when the index is 'match'", () => {
    const call = new CipherstashAddSearchConfigCall(TABLE, FIELD, 'match');
    const op = call.toOp();
    expect(op.id).toBe(`cipherstash-codec.${TABLE}.${FIELD}.add-search-config.match`);
    expect(op.invariantId).toBe(`cipherstash-codec:${TABLE}.${FIELD}:add-search-config:match@v1`);
    expect(op.execute[0]!.sql).toContain(`'match'`);
  });

  it("toOp() defaults the cast type to 'text'", () => {
    const call = new CipherstashAddSearchConfigCall(TABLE, FIELD, 'unique');
    expect(call.toOp().execute[0]!.sql).toContain(`, 'text')`);
  });

  it('toOp() honours an explicit castAs override', () => {
    const call = new CipherstashAddSearchConfigCall(TABLE, FIELD, 'unique', 'jsonb');
    expect(call.toOp().execute[0]!.sql).toContain(`, 'jsonb')`);
  });

  it('toOp() escapes embedded single quotes in identifiers', () => {
    const call = new CipherstashAddSearchConfigCall("us'er", "em'ail", 'unique');
    expect(call.toOp().execute[0]!.sql).toContain("'us''er'");
    expect(call.toOp().execute[0]!.sql).toContain("'em''ail'");
  });

  it("renderTypeScript() emits cipherstashAddSearchConfig({...}) without castAs when 'text'", () => {
    const call = new CipherstashAddSearchConfigCall(TABLE, FIELD, 'unique');
    expect(call.renderTypeScript()).toBe(
      `cipherstashAddSearchConfig({ table: "${TABLE}", column: "${FIELD}", index: "unique" })`,
    );
  });

  it('renderTypeScript() emits castAs only when it differs from the default', () => {
    const call = new CipherstashAddSearchConfigCall(TABLE, FIELD, 'match', 'jsonb');
    expect(call.renderTypeScript()).toBe(
      `cipherstashAddSearchConfig({ table: "${TABLE}", column: "${FIELD}", index: "match", castAs: "jsonb" })`,
    );
  });

  it('importRequirements() pulls cipherstashAddSearchConfig from the /migration subpath', () => {
    const call = new CipherstashAddSearchConfigCall(TABLE, FIELD, 'unique');
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: MIGRATION_MODULE, symbol: 'cipherstashAddSearchConfig' },
    ]);
  });

  it('is frozen at construction', () => {
    const call = new CipherstashAddSearchConfigCall(TABLE, FIELD, 'unique');
    expect(Object.isFrozen(call)).toBe(true);
  });
});

describe('CipherstashRemoveSearchConfigCall', () => {
  it('exposes factoryName, operationClass and label per (table, field, index)', () => {
    const call = new CipherstashRemoveSearchConfigCall(TABLE, FIELD, 'match');
    expect(call.factoryName).toBe('cipherstashRemoveSearchConfig');
    expect(call.operationClass).toBe('destructive');
    expect(call.label).toBe(`Remove cipherstash search config (match) for ${TABLE}.${FIELD}`);
  });

  it('toOp() produces the canonical remove_search_config@v1 op shape', () => {
    const call = new CipherstashRemoveSearchConfigCall(TABLE, FIELD, 'unique');
    expect(call.toOp()).toEqual({
      id: `cipherstash-codec.${TABLE}.${FIELD}.remove-search-config.unique`,
      label: `Remove cipherstash search config (unique) for ${TABLE}.${FIELD}`,
      operationClass: 'destructive',
      invariantId: `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config:unique@v1`,
      target: { id: 'postgres' },
      precheck: [],
      execute: [
        {
          description: `Remove cipherstash unique search config for ${TABLE}.${FIELD}`,
          sql: `SELECT eql_v2.remove_search_config('${TABLE}', '${FIELD}', 'unique');`,
        },
      ],
      postcheck: [],
    });
  });

  it('renderTypeScript() emits cipherstashRemoveSearchConfig({...}) (castAs is irrelevant)', () => {
    const call = new CipherstashRemoveSearchConfigCall(TABLE, FIELD, 'match');
    expect(call.renderTypeScript()).toBe(
      `cipherstashRemoveSearchConfig({ table: "${TABLE}", column: "${FIELD}", index: "match" })`,
    );
  });

  it('importRequirements() pulls cipherstashRemoveSearchConfig from the /migration subpath', () => {
    const call = new CipherstashRemoveSearchConfigCall(TABLE, FIELD, 'unique');
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: MIGRATION_MODULE, symbol: 'cipherstashRemoveSearchConfig' },
    ]);
  });

  it('is frozen at construction', () => {
    const call = new CipherstashRemoveSearchConfigCall(TABLE, FIELD, 'unique');
    expect(Object.isFrozen(call)).toBe(true);
  });
});

describe('cipherstashAddSearchConfig / cipherstashRemoveSearchConfig factories', () => {
  it('cipherstashAddSearchConfig constructs an Add call with the given args', () => {
    const call = cipherstashAddSearchConfig({ table: TABLE, column: FIELD, index: 'unique' });
    expect(call).toBeInstanceOf(CipherstashAddSearchConfigCall);
    expect(call.toOp().invariantId).toBe(
      `cipherstash-codec:${TABLE}.${FIELD}:add-search-config:unique@v1`,
    );
  });

  it('cipherstashAddSearchConfig honours an explicit castAs override', () => {
    const call = cipherstashAddSearchConfig({
      table: TABLE,
      column: FIELD,
      index: 'unique',
      castAs: 'jsonb',
    });
    expect(call.toOp().execute[0]!.sql).toContain(`, 'jsonb')`);
    expect(call.renderTypeScript()).toContain('castAs: "jsonb"');
  });

  it('cipherstashRemoveSearchConfig constructs a Remove call with the given args', () => {
    const call = cipherstashRemoveSearchConfig({ table: TABLE, column: FIELD, index: 'match' });
    expect(call).toBeInstanceOf(CipherstashRemoveSearchConfigCall);
    expect(call.toOp().invariantId).toBe(
      `cipherstash-codec:${TABLE}.${FIELD}:remove-search-config:match@v1`,
    );
  });

  it('CipherstashSearchIndex narrows to the two supported indices', () => {
    const indices: readonly CipherstashSearchIndex[] = ['unique', 'match'];
    expect(indices).toEqual(['unique', 'match']);
  });
});
