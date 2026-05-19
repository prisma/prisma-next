import type { MigrationEdge, MigrationGraph } from '../graph';
import type { Refs } from '../refs';

/** Context required to resolve a contract or migration reference. */
export interface RefResolutionContext {
  readonly graph: MigrationGraph;
  readonly refs: Refs;
}

export type ContractRefProvenance =
  | { readonly kind: 'hash'; readonly input: string }
  | { readonly kind: 'ref'; readonly refName: string }
  | { readonly kind: 'migration-to'; readonly dirName: string }
  | { readonly kind: 'migration-from'; readonly dirName: string };

/** A resolved contract reference: the target hash and how it was derived. */
export interface ContractRef {
  readonly hash: string;
  readonly provenance: ContractRefProvenance;
}

export type MigrationRefProvenance =
  | { readonly kind: 'dir-name'; readonly dirName: string }
  | { readonly kind: 'hash'; readonly input: string };

/** A resolved migration reference. */
export interface MigrationRef {
  readonly dirName: string;
  readonly migrationHash: string;
  readonly from: string;
  readonly to: string;
  readonly provenance: MigrationRefProvenance;
}

export interface RefResolutionNotFound {
  readonly kind: 'not-found';
  readonly input: string;
  readonly grammar: 'contract' | 'migration';
}

export interface RefResolutionAmbiguous {
  readonly kind: 'ambiguous';
  readonly input: string;
  readonly candidates: readonly string[];
  readonly grammar: 'contract' | 'migration';
}

export interface RefResolutionWrongGrammar {
  readonly kind: 'wrong-grammar';
  readonly input: string;
  readonly expectedGrammar: 'contract' | 'migration';
  readonly message: string;
  readonly fix: string;
}

export interface RefResolutionInvalidFormat {
  readonly kind: 'invalid-format';
  readonly input: string;
  readonly reason: string;
}

export type RefResolutionError =
  | RefResolutionNotFound
  | RefResolutionAmbiguous
  | RefResolutionWrongGrammar
  | RefResolutionInvalidFormat;

const FULL_HASH_PATTERN = /^sha256:([0-9a-f]{64}|empty)$/;
const HEX_PREFIX_PATTERN = /^(sha256:)?[0-9a-f]{6,}$/;

export function isFullHash(input: string): boolean {
  return FULL_HASH_PATTERN.test(input);
}

export function isHexPrefix(input: string): boolean {
  return HEX_PREFIX_PATTERN.test(input);
}

export function normalizeHashPrefix(input: string): string {
  return input.startsWith('sha256:') ? input : `sha256:${input}`;
}

export function findEdgeByDirName(
  graph: MigrationGraph,
  dirName: string,
): MigrationEdge | undefined {
  for (const edges of graph.forwardChain.values()) {
    for (const edge of edges) {
      if (edge.dirName === dirName) return edge;
    }
  }
  return undefined;
}
