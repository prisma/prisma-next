import { mapContractMarkerRow, readContractMarker } from './marker';
import type {
  Adapter,
  PostgresContract,
  PostgresLoweredStatement,
  SelectAst,
  Plan,
} from '@prisma/sql/types';

import type { SqlDriver } from '@prisma/sql-target';

export interface RuntimeVerifyOptions {
  readonly mode: 'onFirstUse' | 'startup' | 'always';
  readonly requireMarker: boolean;
}

export interface RuntimeOptions {
  readonly contract: PostgresContract;
  readonly adapter: Adapter<SelectAst, PostgresContract, PostgresLoweredStatement>;
  readonly driver: SqlDriver;
  readonly verify: RuntimeVerifyOptions;
}

export interface Runtime {
  execute(plan: Plan): AsyncIterable<Record<string, any>>;
  close(): Promise<void>;
}

interface RuntimeErrorEnvelope extends Error {
  readonly code: string;
  readonly category: 'PLAN' | 'CONTRACT';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { driver, contract } = options;
  let verified = options.verify.mode === 'startup' ? false : options.verify.mode === 'always';
  let startupVerified = false;

  async function verifyPlanIfNeeded(plan: Plan) {
    if (options.verify.mode === 'always') {
      verified = false;
    }

    if (verified) {
      return;
    }

    const readStatement = readContractMarker();
    const result = await driver.query(readStatement.sql, readStatement.params);

    if (result.rows.length === 0) {
      if (options.verify.requireMarker) {
        throw runtimeError('CONTRACT.MARKER_MISSING', 'Contract marker not found in database');
      }

      verified = true;
      return;
    }

    const marker = mapContractMarkerRow(result.rows[0] as any);

    if (marker.coreHash !== contract.coreHash) {
      throw runtimeError('CONTRACT.MARKER_MISMATCH', 'Database core hash does not match contract', {
        expected: contract.coreHash,
        actual: marker.coreHash,
      });
    }

    const expectedProfile = contract.profileHash ?? null;
    if (expectedProfile !== null && marker.profileHash !== expectedProfile) {
      throw runtimeError(
        'CONTRACT.MARKER_MISMATCH',
        'Database profile hash does not match contract',
        {
          expectedProfile,
          actualProfile: marker.profileHash,
        },
      );
    }

    verified = true;
    startupVerified = true;
  }

  function validatePlan(plan: Plan) {
    if (plan.meta.target !== contract.target) {
      throw runtimeError('PLAN.TARGET_MISMATCH', 'Plan target does not match runtime target', {
        planTarget: plan.meta.target,
        runtimeTarget: contract.target,
      });
    }

    if (plan.meta.coreHash !== contract.coreHash) {
      throw runtimeError('PLAN.HASH_MISMATCH', 'Plan core hash does not match runtime contract', {
        planCoreHash: plan.meta.coreHash,
        runtimeCoreHash: contract.coreHash,
      });
    }
  }

  const runtime: Runtime = {
    execute(plan: Plan): AsyncIterable<Record<string, any>> {
      validatePlan(plan);

      const iterator = async function* () {
        if (!startupVerified && options.verify.mode === 'startup') {
          await verifyPlanIfNeeded(plan);
        }

        if (options.verify.mode === 'onFirstUse') {
          await verifyPlanIfNeeded(plan);
        }

        for await (const row of driver.execute<Record<string, any>>({
          sql: plan.sql,
          params: plan.params,
        })) {
          yield row;
        }
      };

      return iterator();
    },

    close() {
      return driver.close();
    },
  };

  return runtime;
}

function runtimeError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): RuntimeErrorEnvelope {
  const error = new Error(message) as RuntimeErrorEnvelope;
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });

  return Object.assign(error, {
    code,
    category: code.startsWith('PLAN.') ? 'PLAN' : 'CONTRACT',
    severity: 'error' as const,
    message,
    details,
  });
}

export * from './marker';
