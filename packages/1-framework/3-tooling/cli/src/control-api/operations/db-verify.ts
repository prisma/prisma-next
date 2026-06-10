import type { Contract } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyInstance,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import {
  type ContractSpaceMember,
  collectAggregateNamespaces,
  requireHeadRef,
  type VerifierOutput,
  verifyMigration,
} from '@prisma-next/migration-tools/aggregate';
import { blindCast, castAs } from '@prisma-next/utils/casts';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { CliStructuredError } from '../../utils/cli-errors';
import {
  type BuildAggregateInputs,
  buildContractSpaceAggregate,
} from '../../utils/contract-space-aggregate-loader';
import type { OnControlProgress } from '../types';

/**
 * Span IDs emitted via `onProgress` during the aggregate verify flow.
 * Mirrors the span identifiers used by the legacy precheck / marker-check
 * helpers so structured-output renderers and progress tests keep working.
 */
const SPAN_IDS = {
  introspect: 'introspect',
  verify: 'verify',
} as const;

/**
 * Inputs for the aggregate `db verify` operation.
 *
 * Loader → verifier pipeline. The loader (sole descriptor-import
 * boundary) builds a {@link import('@prisma-next/migration-tools/aggregate').ContractSpaceAggregate};
 * the aggregate verifier bundles `markerCheck` + per-space pre-projected
 * `schemaCheck`. `mode: 'strict' | 'lenient'` maps directly to the user
 * facing `--strict` flag.
 */
export interface ExecuteDbVerifyOptions<TFamilyId extends string, TTargetId extends string> {
  readonly driver: ControlDriverInstance<TFamilyId, TTargetId>;
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly contract: Contract;
  readonly migrationsDir: string;
  readonly targetId: TTargetId;
  readonly extensionPacks: ReadonlyArray<ControlExtensionDescriptor<TFamilyId, TTargetId>>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly mode: 'strict' | 'lenient';
  readonly skipSchema: boolean;
  readonly skipMarker: boolean;
  readonly onProgress?: OnControlProgress;
}

/**
 * Result of the aggregate verify operation.
 *
 * Marker-check failures are surfaced as a {@link CliStructuredError}
 * (same envelope code `5002` the legacy `runContractSpaceVerifierMarkerCheck`
 * emitted, so downstream tooling and integration tests assert on the
 * same shape).
 *
 * On success, the per-space schema results are returned for the CLI to
 * render. When `skipSchema` is true (`--marker-only`), the schema map
 * is empty.
 */
export interface ExecuteDbVerifySuccess {
  readonly schemaResults: ReadonlyMap<string, VerifyDatabaseSchemaResult>;
  readonly memberOrder: readonly string[];
  readonly appSpaceId: string;
}

export type ExecuteDbVerifyResult = Result<ExecuteDbVerifySuccess, CliStructuredError>;

/**
 * Loader → verifier pipeline shared by `db verify` modes (`full`,
 * `marker-only`, `schema-only`).
 *
 * 1. **Load**: build a {@link import('@prisma-next/migration-tools/aggregate').ContractSpaceAggregate}
 *    from descriptors + on-disk on-disk artefacts. Layout / drift /
 *    integrity / disjointness violations short-circuit with a
 *    structured CLI error.
 * 2. **Read DB state**: marker rows + (when `skipSchema` is `false`)
 *    schema introspection.
 * 3. **Verify**: {@link verifyMigration} returns per-space
 *    `markerCheck` + per-space pre-projected `schemaCheck` (closes F23).
 *    Marker mismatches map to `CliStructuredError` (code `5002`) so
 *    callers (CLI command) can render and exit. Schema results are
 *    returned to the caller verbatim.
 */
export async function executeDbVerify<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbVerifyOptions<TFamilyId, TTargetId>,
): Promise<ExecuteDbVerifyResult> {
  const { driver, familyInstance, onProgress, skipSchema, skipMarker } = options;
  const loaded = await buildContractSpaceAggregate(buildLoadInputs(options));
  if (!loaded.ok) return notOk(loaded.failure);
  const aggregate = loaded.value;

  const markersBySpaceId = await familyInstance.readAllMarkers({ driver });
  const schemaIntrospection = skipSchema
    ? null
    : await runIntrospection({
        driver,
        familyInstance,
        onProgress,
        contract: collectAggregateNamespaces(aggregate),
      });

  emitVerifySpan(onProgress, 'spanStart');
  const verifyResult = verifyMigration({
    aggregate,
    markersBySpaceId,
    schemaIntrospection,
    mode: options.mode,
    verifySchemaForMember: createPerMemberVerifier(options),
  });
  return finaliseVerifyResult({ verifyResult, aggregate, skipMarker, onProgress });
}

function buildLoadInputs<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbVerifyOptions<TFamilyId, TTargetId>,
): BuildAggregateInputs<TFamilyId, TTargetId> {
  return {
    targetId: options.targetId,
    migrationsDir: options.migrationsDir,
    appContract: options.contract,
    extensionPacks: options.extensionPacks,
    deserializeContract: (json) => options.familyInstance.deserializeContract(json),
  };
}

async function runIntrospection<TFamilyId extends string, TTargetId extends string>(args: {
  driver: ControlDriverInstance<TFamilyId, TTargetId>;
  familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  onProgress: OnControlProgress | undefined;
  contract: unknown;
}): Promise<unknown> {
  const { driver, familyInstance, onProgress, contract } = args;
  onProgress?.({
    action: 'dbVerify',
    kind: 'spanStart',
    spanId: SPAN_IDS.introspect,
    label: 'Introspecting database schema',
  });
  try {
    const result = await familyInstance.introspect({ driver, contract });
    onProgress?.({
      action: 'dbVerify',
      kind: 'spanEnd',
      spanId: SPAN_IDS.introspect,
      outcome: 'ok',
    });
    return result;
  } catch (error) {
    onProgress?.({
      action: 'dbVerify',
      kind: 'spanEnd',
      spanId: SPAN_IDS.introspect,
      outcome: 'error',
    });
    throw error;
  }
}

/**
 * Build the per-member schema callback handed to the aggregate verifier.
 * When `skipSchema` is true the callback short-circuits with a synthetic
 * `ok` result so the verifier still runs the (cheap) schemaCheck loop
 * without invoking the family's verification path.
 */
export function createPerMemberVerifier<TFamilyId extends string, TTargetId extends string>(
  options: ExecuteDbVerifyOptions<TFamilyId, TTargetId>,
): (
  projectedSchema: unknown,
  member: ContractSpaceMember,
  verifyMode: 'strict' | 'lenient',
) => VerifyDatabaseSchemaResult {
  const { skipSchema, familyInstance, frameworkComponents } = options;
  return (projectedSchema, member, verifyMode) => {
    if (skipSchema) return buildSkippedSchemaResult(member);
    return familyInstance.verifySchema({
      contract: member.contract(),
      // The family's `TSchemaIR` is opaque to migration-tools; the
      // aggregate verifier passes through whatever we hand it. The
      // family expects its own IR shape on the way back.
      schema: blindCast<
        never,
        'family TSchemaIR is opaque to migration-tools; projectedSchema is passed straight through'
      >(projectedSchema),
      strict: verifyMode === 'strict',
      frameworkComponents,
    });
  };
}

function emitVerifySpan(
  onProgress: OnControlProgress | undefined,
  kind: 'spanStart' | 'spanEndOk' | 'spanEndError',
): void {
  if (kind === 'spanStart') {
    onProgress?.({
      action: 'dbVerify',
      kind: 'spanStart',
      spanId: SPAN_IDS.verify,
      label: 'Verifying contract spaces',
    });
    return;
  }
  onProgress?.({
    action: 'dbVerify',
    kind: 'spanEnd',
    spanId: SPAN_IDS.verify,
    outcome: kind === 'spanEndOk' ? 'ok' : 'error',
  });
}

/**
 * Map an {@link VerifierOutput} to the operation's
 * {@link ExecuteDbVerifyResult}, applying the `skipMarker` policy used
 * by the CLI's `--schema-only` mode.
 */
function finaliseVerifyResult(args: {
  verifyResult: VerifierOutput<VerifyDatabaseSchemaResult>;
  aggregate: {
    readonly app: { readonly spaceId: string };
    readonly extensions: ReadonlyArray<{ readonly spaceId: string }>;
  };
  skipMarker: boolean;
  onProgress: OnControlProgress | undefined;
}): ExecuteDbVerifyResult {
  const { verifyResult, aggregate, skipMarker, onProgress } = args;
  if (!verifyResult.ok) {
    emitVerifySpan(onProgress, 'spanEndError');
    return notOk(
      new CliStructuredError('5002', 'Aggregate verifier introspection failed', {
        domain: 'MIG',
        why: verifyResult.failure.detail,
        fix: 'Check database connectivity and the introspection tooling.',
        docsUrl: 'https://pris.ly/contract-spaces',
      }),
    );
  }
  const markerError = skipMarker
    ? null
    : mapMarkerCheckFailures(aggregate.app.spaceId, verifyResult.value.markerCheck);
  if (markerError !== null) {
    emitVerifySpan(onProgress, 'spanEndError');
    return notOk(markerError);
  }
  emitVerifySpan(onProgress, 'spanEndOk');
  return ok({
    schemaResults: verifyResult.value.schemaCheck.perSpace,
    memberOrder: [aggregate.app.spaceId, ...aggregate.extensions.map((e) => e.spaceId)],
    appSpaceId: aggregate.app.spaceId,
  });
}

function buildSkippedSchemaResult(member: ContractSpaceMember): VerifyDatabaseSchemaResult {
  const contract = member.contract();
  const headRef = requireHeadRef(member);
  const profileHash = castAs<{ profileHash?: string }>(contract).profileHash;
  return {
    ok: true,
    summary: 'Schema verification skipped',
    contract: {
      storageHash: headRef.hash,
      ...(profileHash ? { profileHash } : {}),
    },
    target: { expected: contract.target },
    schema: {
      issues: [],
      root: {
        status: 'pass',
        kind: 'skipped',
        name: member.spaceId,
        contractPath: '',
        code: 'SKIPPED',
        message: 'Schema verification skipped',
        expected: undefined,
        actual: undefined,
        children: [],
      },
      counts: { pass: 0, warn: 0, fail: 0, totalNodes: 0 },
      extensionIssues: [],
    },
    timings: { total: 0 },
  };
}

/**
 * Translate per-space marker check failures and orphan markers into a
 * single CLI structured error envelope. Preserves the legacy code
 * `5002` (was emitted by `runContractSpaceVerifierMarkerCheck`).
 */
function mapMarkerCheckFailures(
  appSpaceId: string,
  section: {
    readonly perSpace: ReadonlyMap<
      string,
      | { readonly kind: 'ok' }
      | { readonly kind: 'absent' }
      | { readonly kind: 'hashMismatch'; readonly markerHash: string; readonly expected: string }
      | { readonly kind: 'missingInvariants'; readonly missing: readonly string[] }
    >;
    readonly orphanMarkers: readonly { readonly spaceId: string; readonly row: unknown }[];
  },
): CliStructuredError | null {
  const violations: Array<{
    kind: string;
    spaceId: string;
    remediation: string;
  }> = [];
  for (const [spaceId, result] of section.perSpace) {
    if (result.kind === 'ok' || result.kind === 'absent') continue;
    if (result.kind === 'hashMismatch') {
      violations.push({
        kind: 'hashMismatch',
        spaceId,
        remediation:
          spaceId === appSpaceId
            ? 'Run `prisma-next db update` to advance the marker, or roll the database back to the recorded hash.'
            : `Apply on-disk migrations under \`migrations/${spaceId}/\` to advance the marker, or remove the conflicting marker row.`,
      });
      continue;
    }
    if (result.kind === 'missingInvariants') {
      violations.push({
        kind: 'invariantsMismatch',
        spaceId,
        remediation: `Re-apply the migrations under \`migrations/${spaceId}/\` so the marker carries invariants: ${result.missing.join(', ')}.`,
      });
    }
  }
  for (const orphan of section.orphanMarkers) {
    violations.push({
      kind: 'orphanMarker',
      spaceId: orphan.spaceId,
      remediation: `Add the corresponding extension to \`extensionPacks\` in \`prisma-next.config.ts\`, or delete the orphan marker row for "${orphan.spaceId}".`,
    });
  }
  if (violations.length === 0) return null;
  const lines = violations.map((v) => `- [${v.kind}] ${v.spaceId}: ${v.remediation}`);
  const summary =
    violations.length === 1
      ? 'Contract-space verifier found a violation'
      : `Contract-space verifier found violations (${violations.length})`;
  return new CliStructuredError('5002', summary, {
    domain: 'MIG',
    why: `The on-disk \`migrations/\` directory, the \`extensionPacks\` declaration, and the live database marker rows are not in agreement.\n${lines.join('\n')}`,
    fix: violations[0]?.remediation ?? 'Review and reconcile the violations listed above.',
    docsUrl: 'https://pris.ly/contract-spaces',
    meta: { violations },
  });
}
