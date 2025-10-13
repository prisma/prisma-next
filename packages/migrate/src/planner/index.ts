import { Contract, PlannerOptions, PlanArtifacts } from './types';
import { detectChanges } from './detect-changes';
import { buildOperations } from './op-builder';
import { canonicalizeOpSet, computeOpSetHash } from './canonicalize';
import { generateArtifacts } from './artifacts';

/**
 * Plan a migration between two contracts
 *
 * This is the main entry point for the migration planner. It takes two contract IRs
 * (A = current, B = desired) and produces a complete migration program with:
 * - meta.json (metadata)
 * - opset.json (operations)
 * - diff.json (machine-readable diff)
 * - notes.md (human-readable summary)
 *
 * The planner only supports additive changes in MVP:
 * - Add tables, columns, unique constraints, indexes, foreign keys
 * - Fails fast on renames, drops, type changes, NOT NULL without default
 */
export async function planMigration(
  contractA: Contract | { kind: 'empty' },
  contractB: Contract,
  opts: PlannerOptions = {},
): Promise<PlanArtifacts> {
  const { id, rulesVersion = '1' } = opts;

  // Step 1: Detect all changes (throws on unsupported changes)
  const changes = detectChanges(contractA, contractB);

  // Step 2: Build operations from detected changes
  const operations = buildOperations(contractA, contractB, changes);

  // Step 3: Canonicalize operations (stable ordering)
  const opset = canonicalizeOpSet(operations);

  // Step 4: Compute deterministic hash
  const opSetHash = await computeOpSetHash(opset);

  // Step 5: Generate all artifacts
  const artifacts = generateArtifacts(contractA, contractB, opset, opSetHash, changes, id);

  return {
    opset,
    opSetHash,
    ...artifacts,
  };
}

// Re-export types for convenience
export type { Contract, PlannerOptions, PlanArtifacts, DiffSummary, ChangeDetail } from './types';
