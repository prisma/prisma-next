import type { CoreSchemaView } from '@prisma-next/framework-components/control';
import { SchemaTreeNode } from '@prisma-next/framework-components/control';
import type { MongoSchemaCollection, MongoSchemaIR } from '@prisma-next/mongo-schema-ir';

export function mongoSchemaToView(schema: MongoSchemaIR): CoreSchemaView {
  const collectionNodes = schema.collections.map((collection) =>
    collectionToSchemaNode(collection.name, collection),
  );

  return {
    root: new SchemaTreeNode({
      kind: 'root',
      id: 'mongo-schema',
      label: 'database',
      ...(collectionNodes.length > 0 ? { children: collectionNodes } : {}),
    }),
  };
}

function collectionToSchemaNode(name: string, collection: MongoSchemaCollection): SchemaTreeNode {
  const children: SchemaTreeNode[] = [];

  for (const index of collection.indexes) {
    const keysSummary = index.keys
      .map((k) => {
        if (k.direction === 1) return k.field;
        if (k.direction === -1) return `${k.field} desc`;
        return `${k.field} ${k.direction}`;
      })
      .join(', ');
    const prefix = index.unique ? 'unique index' : 'index';
    const options: string[] = [];
    if (index.sparse) options.push('sparse');
    if (index.expireAfterSeconds != null) options.push(`ttl: ${index.expireAfterSeconds}s`);
    if (index.partialFilterExpression) options.push('partial');
    const optsSuffix = options.length > 0 ? ` (${options.join(', ')})` : '';

    children.push(
      new SchemaTreeNode({
        kind: 'index',
        id: `index-${name}-${index.keys.map((k) => `${k.field}_${k.direction}`).join('_')}`,
        label: `${prefix} (${keysSummary})${optsSuffix}`,
        meta: {
          keys: index.keys,
          unique: index.unique,
          ...(index.sparse ? { sparse: index.sparse } : {}),
          ...(index.expireAfterSeconds != null
            ? { expireAfterSeconds: index.expireAfterSeconds }
            : {}),
          ...(index.partialFilterExpression
            ? { partialFilterExpression: index.partialFilterExpression }
            : {}),
        },
      }),
    );
  }

  if (collection.validator) {
    const validatorChildren: SchemaTreeNode[] = [];
    const jsonSchema = collection.validator.jsonSchema as Record<string, unknown>;
    const properties = jsonSchema['properties'] as
      | Record<string, Record<string, unknown>>
      | undefined;
    const required = new Set((jsonSchema['required'] as string[] | undefined) ?? []);

    if (properties) {
      for (const [propName, propDef] of Object.entries(properties)) {
        const bsonType = (propDef['bsonType'] as string) ?? 'unknown';
        const suffix = required.has(propName) ? ' (required)' : '';
        validatorChildren.push(
          new SchemaTreeNode({
            kind: 'field',
            id: `field-${name}-${propName}`,
            label: `${propName}: ${bsonType}${suffix}`,
          }),
        );
      }
    }

    children.push(
      new SchemaTreeNode({
        kind: 'field',
        id: `validator-${name}`,
        label: `validator (level: ${collection.validator.validationLevel}, action: ${collection.validator.validationAction})`,
        meta: {
          validationLevel: collection.validator.validationLevel,
          validationAction: collection.validator.validationAction,
          jsonSchema: collection.validator.jsonSchema,
        },
        ...(validatorChildren.length > 0 ? { children: validatorChildren } : {}),
      }),
    );
  }

  if (collection.options) {
    const opts = collection.options;
    const optLabels: string[] = [];
    if (opts.capped) optLabels.push('capped');
    if (opts.timeseries) optLabels.push('timeseries');
    if (opts.collation) optLabels.push('collation');
    if (opts.changeStreamPreAndPostImages) optLabels.push('changeStreamPreAndPostImages');
    if (opts.clusteredIndex) optLabels.push('clusteredIndex');

    if (optLabels.length > 0) {
      children.push(
        new SchemaTreeNode({
          kind: 'field',
          id: `options-${name}`,
          label: `options (${optLabels.join(', ')})`,
          meta: {
            ...(opts.capped ? { capped: opts.capped } : {}),
            ...(opts.timeseries ? { timeseries: opts.timeseries } : {}),
            ...(opts.collation ? { collation: opts.collation } : {}),
            ...(opts.changeStreamPreAndPostImages
              ? { changeStreamPreAndPostImages: opts.changeStreamPreAndPostImages }
              : {}),
            ...(opts.clusteredIndex ? { clusteredIndex: opts.clusteredIndex } : {}),
          },
        }),
      );
    }
  }

  return new SchemaTreeNode({
    kind: 'collection',
    id: `collection-${name}`,
    label: `collection ${name}`,
    ...(children.length > 0 ? { children } : {}),
  });
}
