/**
 * Re-export all domain error factories from @prisma-next/errors for convenience.
 * CLI-specific errors (e.g., Commander argument validation in the main CLI, or
 * clipanion parse errors in the migration-file CLI) can be added here if needed.
 */
export type { CliErrorConflict, CliErrorEnvelope } from '@prisma-next/errors/control';

import {
  CliStructuredError,
  errorConfigFileNotFound,
  errorConfigValidation,
  errorContractConfigMissing,
  errorContractMissingExtensionPacks,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorFileNotFound,
  errorInvalidOutputFormat,
  errorMigrationCliInvalidConfigArg,
  errorMigrationCliUnknownFlag,
  errorMigrationPlanningFailed,
  errorOutputFormatMutex,
  errorQueryRunnerFactoryRequired,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '@prisma-next/errors/control';
import { errorRuntime } from '@prisma-next/errors/execution';
import type { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import type { RefResolutionError } from '@prisma-next/migration-tools/ref-resolution';
import type { MigrationApplyFailure } from '../control-api/types';

export {
  ERROR_CODE_DESTRUCTIVE_CHANGES,
  errorDestructiveChanges,
  errorHashMismatch,
  errorMarkerMissing,
  errorMarkerRequired,
  errorRunnerFailed,
  errorRuntime,
  errorSchemaVerificationFailed,
  errorTargetMismatch,
} from '@prisma-next/errors/execution';
export {
  errorMigrationFileMissing,
  errorMigrationInvalidDefaultExport,
  errorMigrationPlanNotArray,
  errorUnfilledPlaceholder,
  placeholder,
} from '@prisma-next/errors/migration';
export {
  CliStructuredError,
  errorConfigFileNotFound,
  errorConfigValidation,
  errorContractConfigMissing,
  errorContractMissingExtensionPacks,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorFileNotFound,
  errorInvalidOutputFormat,
  errorMigrationCliInvalidConfigArg,
  errorMigrationCliUnknownFlag,
  errorMigrationPlanningFailed,
  errorOutputFormatMutex,
  errorQueryRunnerFactoryRequired,
  errorTargetMigrationNotSupported,
  errorUnexpected,
};

export function errorPlanForgotTheFlag(
  resolvedHash: string,
  reachableRefs: ReadonlyArray<{ readonly name: string; readonly hash: string }>,
  graphTipHash: string | null,
): CliStructuredError {
  const reachableList =
    reachableRefs.length > 0
      ? reachableRefs.map((r) => `${r.name} (${r.hash})`).join(', ')
      : '(none)';
  const refFix =
    reachableRefs.length > 0
      ? `Run migration plan with ${reachableRefs.map((r) => `--from ${r.name}`).join(' or ')}.`
      : graphTipHash !== null
        ? `Run migration plan --from ${graphTipHash}.`
        : 'Commit pending migrations first, then run migration plan.';
  return errorRuntime(`Resolved from-hash is not in the migration graph: ${resolvedHash}`, {
    why: `The migration graph reaches ${reachableList}; resolved ${resolvedHash} isn't a graph node.`,
    fix: refFix,
    meta: {
      code: 'MIGRATION.HASH_NOT_IN_GRAPH',
      resolvedHash,
      reachableRefs: reachableRefs.map((r) => r.name),
      ...(graphTipHash !== null ? { graphTipHash } : {}),
    },
  });
}

export function errorSnapshotMissing(
  identifier: string,
  options?: { readonly viaRef?: boolean },
): CliStructuredError {
  const viaRef = options?.viaRef !== false;
  const fix = viaRef
    ? `Run "prisma-next db update --advance-ref ${identifier}" to repopulate the snapshot, or "prisma-next ref delete ${identifier}" to clear the orphan pointer.`
    : `No contract source exists for hash "${identifier}" on an empty migration graph. Use --from with a ref name that has a paired snapshot, or run db update first.`;
  return errorRuntime(
    viaRef
      ? `Ref "${identifier}" has no paired contract snapshot`
      : `No contract source for from-hash "${identifier}"`,
    {
      why: viaRef
        ? `Ref "${identifier}" exists but its paired snapshot files are missing.`
        : `Hash "${identifier}" is not a graph node and no paired ref snapshot supplies a contract.`,
      fix,
      meta: {
        code: 'MIGRATION.SNAPSHOT_MISSING',
        identifier,
        viaRef,
      },
    },
  );
}

/**
 * Maps a `MigrationToolsError` raised by the migration-tools loader/graph
 * surface (`readMigrationPackage`, `readMigrationsDir`, `readRefs`,
 * `resolveRef`, `reconstructGraph`, ...) into a CLI `errorRuntime` envelope.
 *
 * The full `error.details` payload is forwarded into `meta` so machine
 * consumers (`--json`) see structural fields like `dir`, `storedHash`,
 * `computedHash` (for `MIGRATION.HASH_MISMATCH`) alongside the stable
 * `code`. The user-visible `summary`/`why`/`fix` text is unchanged.
 *
 * Callers are expected to gate on `MigrationToolsError.is(error)` first
 * (mirroring the original inline pattern); non-`MigrationToolsError`
 * values are caller-classified (rethrow, wrap with command-specific
 * `errorUnexpected`, etc.).
 */
export function errorMarkerMismatch(
  markerHash: string,
  reachableHashes: readonly string[],
  graphTip: string | null,
): CliStructuredError {
  const reachableList =
    reachableHashes.length > 0 ? reachableHashes.join(', ') : '(none — migration graph is empty)';
  const planFromFix =
    graphTip !== null
      ? `Run \`prisma-next migration plan --from ${graphTip}\` if the live marker is canonical and the on-disk graph needs catching up.`
      : 'Run `prisma-next migration plan` if the live marker is canonical and the on-disk graph needs catching up.';
  return errorRuntime('Database marker is not reachable in the on-disk migration graph', {
    why: `DB marker is ${markerHash}, but the on-disk migration graph reaches: ${reachableList}.`,
    fix: [
      planFromFix,
      `Run \`prisma-next ref set db ${markerHash}\` if the on-disk graph is canonical and the local \`db\` ref drifted.`,
      'Investigate whether the database was migrated by an out-of-band process.',
    ].join('\n'),
    meta: {
      code: 'MIGRATION.MARKER_MISMATCH',
      markerHash,
      reachableHashes: [...reachableHashes],
      ...(graphTip !== null ? { graphTip } : {}),
    },
  });
}

export function errorPathUnreachable(failure: MigrationApplyFailure): CliStructuredError {
  const meta = failure.meta ?? {};
  const fromHash = typeof meta['fromHash'] === 'string' ? meta['fromHash'] : '<unknown>';
  const targetHash =
    typeof meta['targetHash'] === 'string'
      ? meta['targetHash']
      : typeof meta['target'] === 'string'
        ? meta['target']
        : '<unknown>';
  const deadEnds = meta['deadEnds'];
  const deadEndsSuffix =
    Array.isArray(deadEnds) && deadEnds.length > 0
      ? ` Dead-ends: ${deadEnds.map(String).join(', ')}.`
      : '';
  return errorRuntime(failure.summary, {
    why:
      failure.why ??
      `Cannot reach target "${targetHash}" from current marker "${fromHash}".${deadEndsSuffix}`,
    fix: [
      'Run `prisma-next migration list` to see the on-disk graph.',
      `Run \`prisma-next migration plan --from ${fromHash} --to ${targetHash}\` to introduce the missing path.`,
      'Run `prisma-next migration show <bundle>` for any bundle in the path you expected.',
    ].join('\n'),
    meta: {
      code: 'MIGRATION.PATH_UNREACHABLE',
      ...meta,
    },
  });
}

export function mapMigrationToolsError(error: MigrationToolsError): CliStructuredError {
  return errorRuntime(error.message, {
    why: error.why,
    fix: error.fix,
    meta: { code: error.code, ...(error.details ?? {}) },
  });
}

/**
 * Maps a `RefResolutionError` from the contract/migration reference
 * resolver into a CLI structured error envelope.
 */
export function mapRefResolutionError(error: RefResolutionError): CliStructuredError {
  switch (error.kind) {
    case 'not-found':
      return errorRuntime(`Not a known ${error.grammar} reference: "${error.input}"`, {
        why: `No ${error.grammar} matching "${error.input}" exists in the migration graph or refs index.`,
        fix:
          error.grammar === 'contract'
            ? 'Provide a valid contract hash, ref name, or migration directory name.'
            : 'Provide a valid migration directory name or migration hash.',
        meta: { input: error.input, grammar: error.grammar },
      });
    case 'ambiguous':
      return errorRuntime(`Ambiguous ${error.grammar} reference: "${error.input}"`, {
        why: `"${error.input}" matches multiple ${error.grammar}s: ${error.candidates.join(', ')}`,
        fix: 'Provide a longer prefix or use the full hash to disambiguate.',
        meta: { input: error.input, candidates: error.candidates, grammar: error.grammar },
      });
    case 'wrong-grammar':
      return errorRuntime(error.message, {
        why: error.message,
        fix: error.fix,
        meta: { input: error.input, expectedGrammar: error.expectedGrammar },
      });
    case 'invalid-format':
      return errorRuntime(`Invalid reference format: "${error.input}"`, {
        why: error.reason,
        fix: 'Provide a valid contract hash, ref name, or migration directory name.',
        meta: { input: error.input },
      });
  }
}
