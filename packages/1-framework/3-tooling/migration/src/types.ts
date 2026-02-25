import type { ContractIR } from '@prisma-next/contract/ir';
import type { AbstractOp } from '@prisma-next/core-control-plane/abstract-ops';

export interface MigrationHints {
  readonly used: readonly string[];
  readonly applied: readonly string[];
  readonly plannerVersion: string;
  readonly planningStrategy: string;
}

export interface MigrationManifest {
  readonly from: string;
  readonly to: string;
  readonly edgeId: string | null;
  readonly kind: 'regular' | 'baseline';
  readonly fromContract: ContractIR | null;
  readonly toContract: ContractIR;
  readonly hints: MigrationHints;
  readonly labels: readonly string[];
  readonly authorship?: { readonly author?: string; readonly email?: string };
  readonly signature?: { readonly keyId: string; readonly value: string } | null;
  readonly createdAt: string;
}

export type MigrationOps = readonly AbstractOp[];

export interface MigrationPackage {
  readonly dirName: string;
  readonly dirPath: string;
  readonly manifest: MigrationManifest;
  readonly ops: MigrationOps;
}

export interface MigrationGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly edgeId: string | null;
  readonly dirName: string;
  readonly createdAt: string;
  readonly labels: readonly string[];
}

export interface MigrationGraph {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlyMap<string, readonly MigrationGraphEdge[]>;
  readonly reverseEdges: ReadonlyMap<string, readonly MigrationGraphEdge[]>;
}
