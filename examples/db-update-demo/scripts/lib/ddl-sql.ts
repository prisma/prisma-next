import { readFileSync } from 'node:fs';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { createControlPlaneStack } from '@prisma-next/core-control-plane/stack';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { contractJsonPath } from './paths';

const INIT_POLICY = { allowedOperationClasses: ['additive'] as const };
const UPDATE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

type PlanMode = 'db-init' | 'db-update';

interface DdlPlanResult {
  readonly ddl: readonly string[];
  readonly operations: number;
  readonly markerMissing: boolean;
  readonly conflicts: readonly unknown[] | null;
}

interface PlanOperationStep {
  readonly sql: string;
}

interface PlanOperation {
  readonly execute?: readonly PlanOperationStep[];
}

function isDdl(sqlStatement: string): boolean {
  const trimmed = sqlStatement.trim().toLowerCase();
  return (
    trimmed.startsWith('create ') ||
    trimmed.startsWith('alter ') ||
    trimmed.startsWith('drop ') ||
    trimmed.startsWith('comment ') ||
    trimmed.startsWith('grant ') ||
    trimmed.startsWith('revoke ') ||
    trimmed.startsWith('truncate ')
  );
}

function extractDdl(operations: readonly PlanOperation[]): string[] {
  const statements: string[] = [];
  for (const operation of operations) {
    for (const step of operation.execute ?? []) {
      if (isDdl(step.sql)) {
        statements.push(step.sql.trim());
      }
    }
  }
  return statements;
}

function loadContractJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as Record<string, unknown>;
}

export async function planDdlSql(
  connectionString: string,
  mode: PlanMode,
  options: { requireMarker?: boolean } = {},
): Promise<DdlPlanResult> {
  const stack = createControlPlaneStack({
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: [],
  });
  const familyInstance = sql.create(stack);
  const driver = await stack.driver?.create(connectionString);
  if (!driver) {
    throw new Error('Driver is not configured for SQL planning.');
  }

  try {
    if (options.requireMarker) {
      const marker = await familyInstance.readMarker({ driver });
      if (!marker) {
        return { ddl: [], operations: 0, markerMissing: true, conflicts: null };
      }
    }

    const contractIR = familyInstance.validateContractIR(loadContractJson());
    const schemaIR = await familyInstance.introspect({ driver });
    const planner = postgres.migrations.createPlanner(familyInstance);
    const policy = mode === 'db-init' ? INIT_POLICY : UPDATE_POLICY;

    const result = await planner.plan({
      contract: contractIR,
      schema: schemaIR,
      policy,
      frameworkComponents: [],
    });

    if (result.kind === 'failure') {
      return {
        ddl: [],
        operations: 0,
        markerMissing: false,
        conflicts: result.conflicts,
      };
    }

    const operations = result.plan.operations as readonly PlanOperation[];
    const ddl = extractDdl(operations);

    return {
      ddl,
      operations: operations.length,
      markerMissing: false,
      conflicts: null,
    };
  } finally {
    await driver.close();
  }
}

export function printDdlSql(title: string, result: DdlPlanResult): void {
  console.log(`\nDDL preview (${title})`);
  if (result.markerMissing) {
    console.log('No DDL (marker missing).');
    return;
  }
  if (result.conflicts && result.conflicts.length > 0) {
    console.log('No DDL (planning conflicts).');
    return;
  }
  if (result.ddl.length === 0) {
    console.log('No DDL operations.');
    return;
  }
  console.log('');
  console.log(result.ddl.map((statement) => `${statement};`).join('\n'));
  console.log('');
}
