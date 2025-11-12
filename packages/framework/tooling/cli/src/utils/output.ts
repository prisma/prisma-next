import type { GlobalFlags } from './global-flags';
import type { CliErrorEnvelope } from './errors';
import type { EmitContractResult } from '../api/emit-contract';
import type { VerifyDatabaseResult } from '../api/verify-database';

/**
 * Formats a timestamp for output.
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Formats human-readable output for contract emit.
 */
export function formatEmitOutput(result: EmitContractResult, flags: GlobalFlags): string {
  const lines: string[] = [];
  const prefix = flags.timestamps ? `[${formatTimestamp()}] ` : '';

  if (!flags.quiet) {
    lines.push(`${prefix}✔ Emitted contract.json → ${result.files.json}`);
    lines.push(`${prefix}✔ Emitted contract.d.ts → ${result.files.dts}`);
    lines.push(`${prefix}  coreHash: ${result.coreHash}`);
    lines.push(`${prefix}  profileHash: ${result.profileHash}`);
    if (flags.verbose >= 1) {
      lines.push(`${prefix}  Total time: ${result.timings.total}ms`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats JSON output for contract emit.
 */
export function formatEmitJson(result: EmitContractResult): string {
  const output: {
    readonly ok: boolean;
    readonly coreHash: string;
    readonly profileHash: string;
    readonly outDir: string;
    readonly files: {
      readonly json: string;
      readonly dts: string;
    };
    readonly timings: {
      readonly total: number;
    };
  } = {
    ok: true,
    coreHash: result.coreHash,
    profileHash: result.profileHash,
    outDir: result.outDir,
    files: result.files,
    timings: result.timings,
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Formats error output for human-readable display.
 */
export function formatErrorOutput(error: CliErrorEnvelope, flags: GlobalFlags): string {
  const lines: string[] = [];
  const prefix = flags.timestamps ? `[${formatTimestamp()}] ` : '';

  lines.push(`${prefix}✖ ${error.summary} (${error.code})`);
  if (error.why) {
    lines.push(`${prefix}  Why: ${error.why}`);
  }
  if (error.fix) {
    lines.push(`${prefix}  Fix: ${error.fix}`);
  }
  if (error.where?.path) {
    const whereLine = error.where.line
      ? `${error.where.path}:${error.where.line}`
      : error.where.path;
    lines.push(`${prefix}  Where: ${whereLine}`);
  }
  if (error.docsUrl && flags.verbose >= 1) {
    lines.push(`${prefix}  Docs: ${error.docsUrl}`);
  }
  if (flags.verbose >= 2 && error.meta) {
    lines.push(`${prefix}  Meta: ${JSON.stringify(error.meta, null, 2)}`);
  }

  return lines.join('\n');
}

/**
 * Formats error output as JSON.
 */
export function formatErrorJson(error: CliErrorEnvelope): string {
  return JSON.stringify(error, null, 2);
}

/**
 * Formats human-readable output for database verify.
 */
export function formatVerifyOutput(result: VerifyDatabaseResult, flags: GlobalFlags): string {
  const lines: string[] = [];
  const prefix = flags.timestamps ? `[${formatTimestamp()}] ` : '';

  if (!flags.quiet) {
    if (result.ok) {
      lines.push(`${prefix}✔ ${result.summary}`);
      lines.push(`${prefix}  coreHash: ${result.contract.coreHash}`);
      if (result.contract.profileHash) {
        lines.push(`${prefix}  profileHash: ${result.contract.profileHash}`);
      }
    } else {
      lines.push(`${prefix}✖ ${result.summary} (${result.code})`);
    }
    if (flags.verbose >= 1) {
      lines.push(`${prefix}  Total time: ${result.timings.total}ms`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats JSON output for database verify.
 */
export function formatVerifyJson(result: VerifyDatabaseResult): string {
  const output: {
    readonly ok: boolean;
    readonly code?: string;
    readonly summary: string;
    readonly contract: {
      readonly coreHash: string;
      readonly profileHash?: string;
    };
    readonly marker?: {
      readonly coreHash?: string;
      readonly profileHash?: string;
    };
    readonly target: {
      readonly expected: string;
      readonly actual?: string;
    };
    readonly missingCodecs?: readonly string[];
    readonly timings: {
      readonly total: number;
    };
  } = {
    ok: result.ok,
    code: result.code,
    summary: result.summary,
    contract: result.contract,
    marker: result.marker,
    target: result.target,
    missingCodecs: result.missingCodecs,
    timings: result.timings,
  };

  return JSON.stringify(output, null, 2);
}
