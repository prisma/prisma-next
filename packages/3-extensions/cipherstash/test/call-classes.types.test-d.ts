/**
 * Type-shape tests pinning `CipherstashSearchIndex` to the full EQL
 * `add_search_config` index vocabulary used across every cipherstash
 * codec (string, double, bigint, date, boolean, json).
 *
 * Negative cases use `@ts-expect-error` per `AGENTS.md § Typesafety
 * rules` — the documented carve-out for negative type tests.
 */

import {
  type CipherstashSearchIndex,
  cipherstashAddSearchConfig,
  cipherstashRemoveSearchConfig,
} from '../src/migration/call-classes';

// --- Positive: every EQL index name is an inhabitant of the union. -----

const _unique: CipherstashSearchIndex = 'unique';
const _match: CipherstashSearchIndex = 'match';
const _ore: CipherstashSearchIndex = 'ore';
const _steVec: CipherstashSearchIndex = 'ste_vec';
void _unique;
void _match;
void _ore;
void _steVec;

// The factory functions accept all four index names without per-codec
// changes — the widening is purely a type-union extension; the factory
// bodies already accept arbitrary `index: string` at runtime.
void cipherstashAddSearchConfig({ table: 't', column: 'c', index: 'unique' });
void cipherstashAddSearchConfig({ table: 't', column: 'c', index: 'match' });
void cipherstashAddSearchConfig({ table: 't', column: 'c', index: 'ore' });
void cipherstashAddSearchConfig({ table: 't', column: 'c', index: 'ste_vec' });

void cipherstashRemoveSearchConfig({ table: 't', column: 'c', index: 'unique' });
void cipherstashRemoveSearchConfig({ table: 't', column: 'c', index: 'match' });
void cipherstashRemoveSearchConfig({ table: 't', column: 'c', index: 'ore' });
void cipherstashRemoveSearchConfig({ table: 't', column: 'c', index: 'ste_vec' });

// --- Negative: an index name outside the EQL vocabulary is rejected. ---

// @ts-expect-error — `'btree'` is not in the EQL search-config index
// vocabulary; the union exists precisely to catch typos at the
// authoring boundary.
const _bogus: CipherstashSearchIndex = 'btree';
void _bogus;

// @ts-expect-error — same negative case routed through the factory:
// no `index` value outside the union compiles.
void cipherstashAddSearchConfig({ table: 't', column: 'c', index: 'btree' });
