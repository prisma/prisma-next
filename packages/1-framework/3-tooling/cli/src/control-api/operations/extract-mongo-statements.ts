import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';

interface MongoIndexKey {
  readonly field: string;
  readonly direction: number | string;
}

interface MongoCommand {
  readonly kind: string;
  readonly collection?: string;
  readonly keys?: ReadonlyArray<MongoIndexKey>;
  readonly unique?: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly name?: string;
}

interface MongoExecuteStep {
  readonly command: MongoCommand;
}

function formatKeySpec(keys: ReadonlyArray<MongoIndexKey>): string {
  const entries = keys.map((k) => `${JSON.stringify(k.field)}: ${JSON.stringify(k.direction)}`);
  return `{ ${entries.join(', ')} }`;
}

function formatCreateIndexOptions(cmd: MongoCommand): string | undefined {
  const parts: string[] = [];
  if (cmd.unique) parts.push('unique: true');
  if (cmd.sparse) parts.push('sparse: true');
  if (cmd.expireAfterSeconds !== undefined)
    parts.push(`expireAfterSeconds: ${cmd.expireAfterSeconds}`);
  if (cmd.name) parts.push(`name: ${JSON.stringify(cmd.name)}`);
  if (parts.length === 0) return undefined;
  return `{ ${parts.join(', ')} }`;
}

function formatCommand(cmd: MongoCommand): string | undefined {
  switch (cmd.kind) {
    case 'createIndex': {
      if (!cmd.keys || !cmd.collection) return undefined;
      const keySpec = formatKeySpec(cmd.keys);
      const opts = formatCreateIndexOptions(cmd);
      return opts
        ? `db.${cmd.collection}.createIndex(${keySpec}, ${opts})`
        : `db.${cmd.collection}.createIndex(${keySpec})`;
    }
    case 'dropIndex':
      if (!cmd.collection || !cmd.name) return undefined;
      return `db.${cmd.collection}.dropIndex(${JSON.stringify(cmd.name)})`;
    default:
      return undefined;
  }
}

function hasMongoExecuteSteps(
  operation: MigrationPlanOperation,
): operation is MigrationPlanOperation & { readonly execute: readonly MongoExecuteStep[] } {
  const candidate = operation as unknown as Record<string, unknown>;
  if (!('execute' in candidate) || !Array.isArray(candidate['execute'])) {
    return false;
  }
  return candidate['execute'].every(
    (step: unknown) =>
      typeof step === 'object' &&
      step !== null &&
      'command' in step &&
      typeof (step as Record<string, unknown>)['command'] === 'object',
  );
}

export function extractMongoStatements(operations: readonly MigrationPlanOperation[]): string[] {
  const statements: string[] = [];
  for (const operation of operations) {
    if (!hasMongoExecuteSteps(operation)) {
      continue;
    }
    for (const step of operation.execute) {
      const formatted = formatCommand(step.command);
      if (formatted) {
        statements.push(formatted);
      }
    }
  }
  return statements;
}
