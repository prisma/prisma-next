import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import type {
  CreateIndexCommand,
  DropIndexCommand,
  MongoDdlCommandVisitor,
  MongoIndexKey,
} from '@prisma-next/mongo-query-ast/control';

function formatKeySpec(keys: ReadonlyArray<MongoIndexKey>): string {
  const entries = keys.map((k) => `${JSON.stringify(k.field)}: ${JSON.stringify(k.direction)}`);
  return `{ ${entries.join(', ')} }`;
}

function formatOptions(cmd: CreateIndexCommand): string | undefined {
  const parts: string[] = [];
  if (cmd.unique) parts.push('unique: true');
  if (cmd.sparse) parts.push('sparse: true');
  if (cmd.expireAfterSeconds !== undefined)
    parts.push(`expireAfterSeconds: ${cmd.expireAfterSeconds}`);
  if (cmd.name) parts.push(`name: ${JSON.stringify(cmd.name)}`);
  if (parts.length === 0) return undefined;
  return `{ ${parts.join(', ')} }`;
}

class MongoDdlCommandFormatter implements MongoDdlCommandVisitor<string> {
  createIndex(cmd: CreateIndexCommand): string {
    const keySpec = formatKeySpec(cmd.keys);
    const opts = formatOptions(cmd);
    return opts
      ? `db.${cmd.collection}.createIndex(${keySpec}, ${opts})`
      : `db.${cmd.collection}.createIndex(${keySpec})`;
  }

  dropIndex(cmd: DropIndexCommand): string {
    return `db.${cmd.collection}.dropIndex(${JSON.stringify(cmd.name)})`;
  }
}

const formatter = new MongoDdlCommandFormatter();

interface MongoExecuteStep {
  readonly command: { readonly accept: <R>(visitor: MongoDdlCommandVisitor<R>) => R };
}

export function formatMongoOperations(operations: readonly MigrationPlanOperation[]): string[] {
  const statements: string[] = [];
  for (const operation of operations) {
    const candidate = operation as unknown as Record<string, unknown>;
    if (!('execute' in candidate) || !Array.isArray(candidate['execute'])) {
      continue;
    }
    for (const step of candidate['execute'] as MongoExecuteStep[]) {
      if (step.command && typeof step.command.accept === 'function') {
        statements.push(step.command.accept(formatter));
      }
    }
  }
  return statements;
}
