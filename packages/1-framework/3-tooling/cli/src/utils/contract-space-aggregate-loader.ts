import type { Contract } from '@prisma-next/contract/types';
import type { ControlExtensionDescriptor } from '@prisma-next/framework-components/control';
import type {
  ContractSpaceAggregate,
  DeclaredExtensionEntry,
  IntegrityViolation,
} from '@prisma-next/migration-tools/aggregate';
import { loadContractSpaceAggregate } from '@prisma-next/migration-tools/aggregate';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { CliStructuredError } from './cli-errors';
import { toDeclaredExtensionsFromRaw } from './extension-pack-inputs';

/**
 * Build the `5002` structured-error envelope for a contract-space
 * target mismatch. Shared between the declared-extension precheck (the
 * descriptor's configured target disagrees with the project target) and
 * the on-disk-contract check surfaced by `checkIntegrity`.
 */
function targetMismatchError(
  spaceId: string,
  expected: string,
  actual: string,
): CliStructuredError {
  return new CliStructuredError('5002', `Contract-space target mismatch for "${spaceId}"`, {
    domain: 'MIG',
    why: `Space "${spaceId}" targets "${actual}" but the project's adapter targets "${expected}".`,
    fix: 'Update the extension descriptor to target the configured database, or change the project adapter.',
    meta: {
      violations: [{ kind: 'targetMismatch', spaceId, expected, actual }],
    },
  });
}

/**
 * Human-readable detail for an integrity violation, used as the `why`
 * of the `integrityFailure` envelope. Mirrors the messages the prior
 * throw-on-load loader produced so downstream consumers see the same
 * text for the same on-disk state.
 */
function describeIntegrityViolation(violation: IntegrityViolation): string {
  switch (violation.kind) {
    case 'hashMismatch':
      return `Migration "${violation.dirName}" stored hash "${violation.stored}" does not match computed hash "${violation.computed}".`;
    case 'providedInvariantsMismatch':
      return `Migration "${violation.dirName}" providedInvariants in migration.json disagrees with ops.json.`;
    case 'packageUnloadable':
      return `Migration "${violation.dirName}" could not be loaded: ${violation.detail}`;
    case 'sameSourceAndTarget':
      return `Migration "${violation.dirName}" has source equal to target (${violation.hash}) with no data operation.`;
    case 'headRefMissing':
      return `Head ref \`refs/head.json\` is missing for contract space "${violation.spaceId}".`;
    case 'headRefNotInGraph':
      return `Head ref ${violation.hash} for contract space "${violation.spaceId}" is not present in the migration graph.`;
    case 'refUnreadable':
      return `Ref "${violation.refName}" for contract space "${violation.spaceId}" is unreadable: ${violation.detail}`;
    case 'duplicateMigrationHash':
      return `Multiple migrations in space "${violation.spaceId}" share migrationHash "${violation.migrationHash}" (${violation.dirNames.join(', ')}).`;
    default: {
      const spaceId = 'spaceId' in violation ? violation.spaceId : '*';
      return `Integrity violation "${violation.kind}" for contract space "${spaceId}".`;
    }
  }
}

/**
 * Map the integrity violations `checkIntegrity` reports into a single
 * CLI structured-error envelope, preserving the error codes the prior
 * throw-on-load loader emitted: `5001` (layout drift, bundled) and
 * `5002` (target / disjointness / contract-validation / structural
 * integrity). Returns `null` when there is nothing to refuse on.
 *
 * Precedence reproduces the prior loader's first-failure ordering:
 * layout drift first (every offence bundled into one envelope), then
 * target mismatch, then disjointness, then a contract-validation
 * failure, then any remaining structural integrity violation.
 */
export function mapIntegrityViolations(
  violations: readonly IntegrityViolation[],
): CliStructuredError | null {
  if (violations.length === 0) return null;

  const layout = violations.filter(
    (v): v is Extract<IntegrityViolation, { kind: 'orphanSpaceDir' | 'declaredButUnmigrated' }> =>
      v.kind === 'orphanSpaceDir' || v.kind === 'declaredButUnmigrated',
  );
  if (layout.length > 0) {
    const lines = layout.map((v) => `- [${v.kind}] ${v.spaceId}`);
    const summary =
      layout.length === 1
        ? 'Contract-space layout violation detected'
        : `Contract-space layout violations detected (${layout.length})`;
    return new CliStructuredError('5001', summary, {
      domain: 'MIG',
      why: `The on-disk \`migrations/\` directory and your \`extensionPacks\` declaration are not in agreement.\n${lines.join('\n')}`,
      fix: 'Run `prisma-next migrate` to materialise on-disk artefacts for declared extensions, or remove the orphan directory.',
      docsUrl: 'https://pris.ly/contract-spaces',
      meta: {
        violations: layout.map((v) => ({ kind: v.kind, spaceId: v.spaceId })),
      },
    });
  }

  const targetMismatch = violations.find((v) => v.kind === 'targetMismatch');
  if (targetMismatch && targetMismatch.kind === 'targetMismatch') {
    return targetMismatchError(
      targetMismatch.spaceId,
      targetMismatch.expected,
      targetMismatch.actual,
    );
  }

  const disjointness = violations.find((v) => v.kind === 'disjointness');
  if (disjointness && disjointness.kind === 'disjointness') {
    return new CliStructuredError(
      '5002',
      `Contract-space disjointness violation: storage element "${disjointness.element}" claimed by multiple spaces`,
      {
        domain: 'MIG',
        why: `Spaces ${disjointness.claimedBy.map((s) => `"${s}"`).join(', ')} all claim the storage element "${disjointness.element}". Each storage element must be owned by exactly one contract space.`,
        fix: 'Update the conflicting contracts so each storage element is claimed by exactly one space.',
        docsUrl: 'https://pris.ly/contract-spaces',
        meta: {
          violations: [
            {
              kind: 'disjointness',
              spaceId: disjointness.claimedBy.join(','),
              element: disjointness.element,
              claimedBy: disjointness.claimedBy,
            },
          ],
        },
      },
    );
  }

  const contractUnreadable = violations.find((v) => v.kind === 'contractUnreadable');
  if (contractUnreadable && contractUnreadable.kind === 'contractUnreadable') {
    return new CliStructuredError(
      '5002',
      `Contract-space contract validation failed for "${contractUnreadable.spaceId}"`,
      {
        domain: 'MIG',
        why: contractUnreadable.detail,
        fix: 'Run `prisma-next migrate` to refresh on-disk artefacts, or fix the extension descriptor producing the invalid contract.',
        meta: {
          violations: [
            {
              kind: 'validation',
              spaceId: contractUnreadable.spaceId,
              detail: contractUnreadable.detail,
            },
          ],
        },
      },
    );
  }

  // Any remaining recoverable structural violation refuses as an
  // integrity failure, surfacing the first one's detail (every violation
  // is still computed; the gate just renders one envelope).
  const structural = violations[0]!;
  const spaceId = 'spaceId' in structural ? structural.spaceId : '*';
  return new CliStructuredError('5002', `Contract-space integrity failure for "${spaceId}"`, {
    domain: 'MIG',
    why: describeIntegrityViolation(structural),
    fix: 'Run `prisma-next migrate` to refresh on-disk artefacts, or restore the on-disk `migrations/` directory from version control.',
    docsUrl: 'https://pris.ly/contract-spaces',
    meta: {
      violations: [{ kind: 'integrity', spaceId, detail: describeIntegrityViolation(structural) }],
    },
  });
}

/**
 * Inputs needed to compose the aggregate loader at the CLI surface.
 *
 * Keeps the loader framework-neutral (no `Config` import) by accepting
 * already-resolved structural inputs: validated app contract, target
 * id, migrations root directory, and the set of extension descriptors.
 */
export interface BuildAggregateInputs<TFamilyId extends string, TTargetId extends string> {
  readonly targetId: TTargetId;
  readonly migrationsDir: string;
  readonly appContract: Contract;
  readonly extensionPacks: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>;
  readonly deserializeContract: (contractJson: unknown) => Contract;
}

/**
 * Construct the tolerant {@link ContractSpaceAggregate} at the CLI
 * surface and apply the explicit integrity gate.
 *
 * Construction never throws on disk content: the aggregate loader reads
 * every space's packages, refs, and head ref tolerantly, synthesising
 * the app head ref from the live contract's storage hash and reading
 * extension state (packages / refs / contract.json) from disk. The gate
 * then runs `checkIntegrity({ declaredExtensions, checkContracts })`
 * — the same checks the prior throw-on-load loader enforced — and maps
 * any violation into a {@link CliStructuredError}, so callers that
 * previously relied on construction-time throws refuse identically.
 *
 * App-space migration packages are read from `migrations/<app>/` by the
 * loader itself; callers no longer thread them through.
 */
export async function buildContractSpaceAggregate<
  TFamilyId extends string,
  TTargetId extends string,
>(
  inputs: BuildAggregateInputs<TFamilyId, TTargetId>,
): Promise<Result<ContractSpaceAggregate, CliStructuredError>> {
  const declaredExtensions: readonly DeclaredExtensionEntry[] = toDeclaredExtensionsFromRaw(
    inputs.extensionPacks as ReadonlyArray<unknown>,
  );

  // Precheck the declared targets before touching disk: a descriptor
  // configured for a different target than the project's is a
  // configuration error independent of on-disk state, and the prior
  // loader rejected it first.
  for (const declared of declaredExtensions) {
    if (declared.targetId !== inputs.targetId) {
      return notOk(targetMismatchError(declared.id, inputs.targetId, declared.targetId));
    }
  }

  const aggregate = await loadContractSpaceAggregate({
    migrationsDir: inputs.migrationsDir,
    deserializeContract: inputs.deserializeContract,
    appContract: inputs.appContract,
  });

  const violations = aggregate.checkIntegrity({ declaredExtensions, checkContracts: true });
  const failure = mapIntegrityViolations(violations);
  if (failure) {
    return notOk(failure);
  }
  return ok(aggregate);
}
