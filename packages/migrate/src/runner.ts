import { AdminConnection } from './admin-connection';
import { DialectLowerer } from './lowering/postgres';
import { MigrationProgram, ContractMarker, hashOpSet } from './program';
import { renderScript } from './lowering/renderer';

// Apply options
export type ApplyOptions = {
  mode?: 'strict' | 'tolerant';
  dryRun?: boolean;
};

// Apply report
export type ApplyReport = {
  programId: string;
  from: MigrationProgram['meta']['from'];
  to: MigrationProgram['meta']['to'];
  applied: boolean;
  reason?: 'not-applicable' | 'strict-mismatch' | 'noop';
  sql?: string;
  sqlHash?: `sha256:${string}`;
};

// Apply a single migration program
export async function applyNext(
  programs: MigrationProgram[],
  admin: AdminConnection,
  lowerer: DialectLowerer,
  opts: ApplyOptions = {},
): Promise<ApplyReport> {
  // Read current contract state
  const current = await admin.readContract();

  // Find next applicable program
  const program = programs.find((p) => {
    switch (p.meta.from.kind) {
      case 'empty':
        return current.hash === null;
      case 'unknown':
        return true;
      case 'contract':
        return current.hash === p.meta.from.hash;
      case 'anyOf':
        return current.hash !== null && p.meta.from.hashes.includes(current.hash);
      default:
        return false;
    }
  });

  if (!program) {
    return {
      programId: '',
      from: { kind: 'contract', hash: current.hash as `sha256:${string}` },
      to: { kind: 'contract', hash: current.hash as `sha256:${string}` },
      applied: false,
      reason: 'not-applicable',
    };
  }

  // Validate opset integrity
  const computedHash = await hashOpSet(program.ops);
  if (computedHash !== program.meta.opSetHash) {
    throw new Error(
      `OpSet hash mismatch for ${program.meta.id}: expected ${program.meta.opSetHash}, got ${computedHash}`,
    );
  }

  // Apply strict/tolerant mode logic
  const effectiveMode = opts.mode ?? program.meta.mode ?? 'strict';
  if (effectiveMode === 'strict') {
    const matches = (() => {
      switch (program.meta.from.kind) {
        case 'empty':
          return current.hash === null;
        case 'unknown':
          return true;
        case 'contract':
          return current.hash === program.meta.from.hash;
        case 'anyOf':
          return current.hash !== null && program.meta.from.hashes.includes(current.hash);
        default:
          return false;
      }
    })();

    if (!matches) {
      return {
        programId: program.meta.id,
        from: program.meta.from,
        to: program.meta.to,
        applied: false,
        reason: 'strict-mismatch',
      };
    }
  }

  // Lower ops to ScriptAST
  const script = lowerer.lower(program.ops.operations);

  // Execute under advisory lock
  const result = await admin.withAdvisoryLock('prisma:migrate', async () => {
    if (opts.dryRun) {
      const { sql, sqlHash } = renderScript(script);
      return { sql, sqlHash: sqlHash as `sha256:${string}` };
    }

    const execResult = await admin.executeScript(script);
    await admin.writeContract(program.meta.to.hash);
    return execResult;
  });

  return {
    programId: program.meta.id,
    from: program.meta.from,
    to: program.meta.to,
    applied: true,
    sql: result.sql,
    sqlHash: result.sqlHash,
  };
}

// Apply all applicable migration programs
export async function applyAll(
  programs: MigrationProgram[],
  admin: AdminConnection,
  lowerer: DialectLowerer,
  opts: ApplyOptions = {},
): Promise<ApplyReport[]> {
  const reports: ApplyReport[] = [];

  for (;;) {
    const report = await applyNext(programs, admin, lowerer, opts);
    reports.push(report);

    if (!report.applied && report.reason === 'not-applicable') {
      break;
    }

    if (!report.applied && report.reason === 'strict-mismatch') {
      throw new Error(`Strict mismatch for program ${report.programId} - aborting`);
    }
  }

  return reports;
}
