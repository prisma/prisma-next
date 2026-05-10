import type { Contract } from '@prisma-next/contract/types';
import type { ControlExtensionDescriptor } from '@prisma-next/framework-components/control';
import type {
  ContractSpaceAggregate,
  LoadAggregateError,
  LoadAggregateInput,
  LoadAggregateOutput,
} from '@prisma-next/migration-tools/aggregate';
import { loadContractSpaceAggregate } from '@prisma-next/migration-tools/aggregate';
import type { OnDiskMigrationPackage } from '@prisma-next/migration-tools/package';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { CliStructuredError } from './cli-errors';
import { toDeclaredExtensions, toExtensionInputs } from './extension-pack-inputs';

/**
 * Render a {@link LoadAggregateError} into a CLI structured-error
 * envelope. Preserves error codes `5001` (layout) and `5002` (marker /
 * drift / disjointness / etc.) so existing integration tests and
 * downstream tooling continue to assert on the same `meta.violations[]`
 * shape they did under the old precheck/marker-check helpers.
 */
export function mapLoadAggregateError(error: LoadAggregateError): CliStructuredError {
  if (error.kind === 'layoutViolation') {
    const lines = error.violations.map((v) => `- [${v.kind}] ${v.spaceId}`);
    const summary =
      error.violations.length === 1
        ? 'Contract-space layout violation detected'
        : `Contract-space layout violations detected (${error.violations.length})`;
    return new CliStructuredError('5001', summary, {
      domain: 'MIG',
      why: `The on-disk \`migrations/\` directory and your \`extensionPacks\` declaration are not in agreement.\n${lines.join('\n')}`,
      fix: 'Run `prisma-next migrate` to materialise on-disk artefacts for declared extensions, or remove the orphan directory.',
      docsUrl: 'https://pris.ly/contract-spaces',
      meta: {
        violations: error.violations.map((v) => ({
          kind: v.kind,
          spaceId: v.spaceId,
        })),
      },
    });
  }
  if (error.kind === 'driftViolation') {
    return new CliStructuredError('5002', `Contract-space drift detected for "${error.spaceId}"`, {
      domain: 'MIG',
      why: `The on-disk contract for space "${error.spaceId}" (hash ${error.priorHeadHash}) does not match the live extension descriptor (hash ${error.liveHash}).`,
      fix: 'Run `prisma-next migrate` to refresh the on-disk artefacts to match the live descriptor.',
      docsUrl: 'https://pris.ly/contract-spaces',
      meta: {
        violations: [
          {
            kind: 'drift',
            spaceId: error.spaceId,
            priorHeadHash: error.priorHeadHash,
            liveHash: error.liveHash,
          },
        ],
      },
    });
  }
  if (error.kind === 'disjointnessViolation') {
    return new CliStructuredError(
      '5002',
      `Contract-space disjointness violation: storage element "${error.element}" claimed by multiple spaces`,
      {
        domain: 'MIG',
        why: `Spaces ${error.claimedBy.map((s) => `"${s}"`).join(', ')} all claim the storage element "${error.element}". Each storage element must be owned by exactly one contract space.`,
        fix: 'Update the conflicting contracts so each storage element is claimed by exactly one space.',
        docsUrl: 'https://pris.ly/contract-spaces',
        meta: {
          violations: [
            {
              kind: 'disjointness',
              spaceId: error.claimedBy.join(','),
              element: error.element,
              claimedBy: error.claimedBy,
            },
          ],
        },
      },
    );
  }
  if (error.kind === 'integrityFailure') {
    return new CliStructuredError(
      '5002',
      `Contract-space integrity failure for "${error.spaceId}"`,
      {
        domain: 'MIG',
        why: error.detail,
        fix: 'Run `prisma-next migrate` to refresh on-disk artefacts, or restore the on-disk `migrations/` directory from version control.',
        docsUrl: 'https://pris.ly/contract-spaces',
        meta: {
          violations: [{ kind: 'integrity', spaceId: error.spaceId, detail: error.detail }],
        },
      },
    );
  }
  if (error.kind === 'validationFailure') {
    return new CliStructuredError(
      '5002',
      `Contract-space contract validation failed for "${error.spaceId}"`,
      {
        domain: 'MIG',
        why: error.detail,
        fix: 'Run `prisma-next migrate` to refresh on-disk artefacts, or fix the extension descriptor producing the invalid contract.',
        meta: {
          violations: [{ kind: 'validation', spaceId: error.spaceId, detail: error.detail }],
        },
      },
    );
  }
  // targetMismatch
  return new CliStructuredError('5002', `Contract-space target mismatch for "${error.spaceId}"`, {
    domain: 'MIG',
    why: `Space "${error.spaceId}" targets "${error.actual}" but the project's adapter targets "${error.expected}".`,
    fix: 'Update the extension descriptor to target the configured database, or change the project adapter.',
    meta: {
      violations: [
        {
          kind: 'targetMismatch',
          spaceId: error.spaceId,
          expected: error.expected,
          actual: error.actual,
        },
      ],
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
  readonly validateContract: (contractJson: unknown) => Contract;
  /**
   * App-space migration packages to hydrate the app member's
   * migration graph with. Defaults to `[]` (matches the `db init` /
   * `db update` daily-driver behaviour, where the app's authored
   * `migrations/` graph is not walked — the planner uses the synth
   * strategy for the app member instead).
   *
   * `migration apply` callers thread the user's authored app-space
   * packages (loaded via `loadMigrationPackages(appMigrationsDir)`)
   * through here so the graph-walk strategy can plot a path through
   * them — the prod-time replay path explicitly forbids synth.
   */
  readonly appMigrationPackages?: ReadonlyArray<OnDiskMigrationPackage>;
}

/**
 * Run the aggregate loader at the CLI surface, mapping any
 * {@link LoadAggregateError} into a {@link CliStructuredError} envelope.
 *
 * App-side migration packages are intentionally not threaded through:
 * `db init` / `db update` go through the planner's `synth` strategy for
 * the app member (driven by `callerPolicy.ignoreGraphFor`), so the
 * app's authored `migrations/` graph is not walked.
 *
 * @see specs/contract-space-aggregate-spec.md § Loader.
 */
export async function buildContractSpaceAggregate<
  TFamilyId extends string,
  TTargetId extends string,
>(
  inputs: BuildAggregateInputs<TFamilyId, TTargetId>,
): Promise<Result<ContractSpaceAggregate, CliStructuredError>> {
  const { entries, hashByContractJson } = toDeclaredExtensions(
    toExtensionInputs(inputs.extensionPacks),
  );

  const loadInput: LoadAggregateInput = {
    targetId: inputs.targetId,
    migrationsDir: inputs.migrationsDir,
    appContract: inputs.appContract,
    declaredExtensions: entries,
    validateContract: inputs.validateContract,
    hashContract: (contractJson: unknown) => {
      const precomputed = hashByContractJson.get(contractJson);
      if (precomputed === undefined) {
        throw new Error(
          'CLI aggregate loader: encountered an extension contract without a pre-computed descriptor hash. This is a wiring bug.',
        );
      }
      return precomputed;
    },
    appMigrationPackages: inputs.appMigrationPackages ?? [],
  };

  const result: LoadAggregateOutput = await loadContractSpaceAggregate(loadInput);
  if (!result.ok) {
    return notOk(mapLoadAggregateError(result.failure));
  }
  return ok(result.value.aggregate);
}
