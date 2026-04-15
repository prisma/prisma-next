import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import type {
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
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
  if (cmd.collation) parts.push(`collation: ${JSON.stringify(cmd.collation)}`);
  if (cmd.weights) parts.push(`weights: ${JSON.stringify(cmd.weights)}`);
  if (cmd.default_language) parts.push(`default_language: ${JSON.stringify(cmd.default_language)}`);
  if (cmd.language_override)
    parts.push(`language_override: ${JSON.stringify(cmd.language_override)}`);
  if (cmd.wildcardProjection)
    parts.push(`wildcardProjection: ${JSON.stringify(cmd.wildcardProjection)}`);
  if (cmd.partialFilterExpression)
    parts.push(`partialFilterExpression: ${JSON.stringify(cmd.partialFilterExpression)}`);
  if (parts.length === 0) return undefined;
  return `{ ${parts.join(', ')} }`;
}

function formatCreateCollectionOptions(cmd: CreateCollectionCommand): string | undefined {
  const parts: string[] = [];
  if (cmd.capped) parts.push('capped: true');
  if (cmd.size !== undefined) parts.push(`size: ${cmd.size}`);
  if (cmd.max !== undefined) parts.push(`max: ${cmd.max}`);
  if (cmd.timeseries) parts.push(`timeseries: ${JSON.stringify(cmd.timeseries)}`);
  if (cmd.collation) parts.push(`collation: ${JSON.stringify(cmd.collation)}`);
  if (cmd.clusteredIndex) parts.push(`clusteredIndex: ${JSON.stringify(cmd.clusteredIndex)}`);
  if (cmd.validator) parts.push(`validator: ${JSON.stringify(cmd.validator)}`);
  if (cmd.validationLevel) parts.push(`validationLevel: ${JSON.stringify(cmd.validationLevel)}`);
  if (cmd.validationAction) parts.push(`validationAction: ${JSON.stringify(cmd.validationAction)}`);
  if (cmd.changeStreamPreAndPostImages)
    parts.push(`changeStreamPreAndPostImages: ${JSON.stringify(cmd.changeStreamPreAndPostImages)}`);
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

  createCollection(cmd: CreateCollectionCommand): string {
    const opts = formatCreateCollectionOptions(cmd);
    return opts
      ? `db.createCollection(${JSON.stringify(cmd.collection)}, ${opts})`
      : `db.createCollection(${JSON.stringify(cmd.collection)})`;
  }

  dropCollection(cmd: DropCollectionCommand): string {
    return `db.${cmd.collection}.drop()`;
  }

  collMod(cmd: CollModCommand): string {
    const parts: string[] = [`collMod: ${JSON.stringify(cmd.collection)}`];
    if (cmd.validator) parts.push(`validator: ${JSON.stringify(cmd.validator)}`);
    if (cmd.validationLevel) parts.push(`validationLevel: ${JSON.stringify(cmd.validationLevel)}`);
    if (cmd.validationAction)
      parts.push(`validationAction: ${JSON.stringify(cmd.validationAction)}`);
    if (cmd.changeStreamPreAndPostImages)
      parts.push(
        `changeStreamPreAndPostImages: ${JSON.stringify(cmd.changeStreamPreAndPostImages)}`,
      );
    return `db.runCommand({ ${parts.join(', ')} })`;
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
