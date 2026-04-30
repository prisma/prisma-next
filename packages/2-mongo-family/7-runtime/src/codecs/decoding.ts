import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { MongoCodecRegistry } from '@prisma-next/mongo-codec';
import type { MongoFieldShape, MongoResultShape } from '@prisma-next/mongo-query-ast/execution';

const WIRE_PREVIEW_LIMIT = 100;

function previewWireValue(wireValue: unknown): string {
  if (typeof wireValue === 'string') {
    return wireValue.length > WIRE_PREVIEW_LIMIT
      ? `${wireValue.substring(0, WIRE_PREVIEW_LIMIT)}...`
      : wireValue;
  }
  return String(wireValue).substring(0, WIRE_PREVIEW_LIMIT);
}

function wrapDecodeFailure(
  error: unknown,
  collection: string,
  path: string,
  codecId: string,
  wireValue: unknown,
): never {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = runtimeError(
    'RUNTIME.DECODE_FAILED',
    `Failed to decode field ${path} in collection '${collection}' with codec '${codecId}': ${message}`,
    {
      collection,
      path,
      codec: codecId,
      wirePreview: previewWireValue(wireValue),
    },
  );
  wrapped.cause = error;
  throw wrapped;
}

export async function decodeMongoRow(
  row: unknown,
  shape: MongoResultShape,
  registry: MongoCodecRegistry,
  collection: string,
): Promise<unknown> {
  if (shape.kind === 'unknown') {
    return row;
  }
  if (typeof row !== 'object' || row === null) {
    return row;
  }
  const rowObj = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const tasks: Array<Promise<void>> = [];

  function scheduleLeaf(
    path: string,
    codecId: string,
    wire: unknown,
    assign: (v: unknown) => void,
  ): void {
    const codec = registry.get(codecId);
    if (!codec) {
      assign(wire);
      return;
    }
    tasks.push(
      (async () => {
        try {
          assign(await codec.decode(wire));
        } catch (error) {
          wrapDecodeFailure(error, collection, path, codecId, wire);
        }
      })(),
    );
  }

  function walkField(
    value: unknown,
    fieldShape: MongoFieldShape,
    path: string,
    assign: (v: unknown) => void,
  ): void {
    switch (fieldShape.kind) {
      case 'unknown':
        assign(value);
        return;
      case 'leaf':
        if (value === null || value === undefined) {
          assign(value);
          return;
        }
        scheduleLeaf(path, fieldShape.codecId, value, assign);
        return;
      case 'document': {
        if (value === null || value === undefined) {
          assign(value);
          return;
        }
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          assign(value);
          return;
        }
        const vObj = value as Record<string, unknown>;
        const nested: Record<string, unknown> = {};
        assign(nested);
        for (const [fk, fShape] of Object.entries(fieldShape.fields)) {
          walkField(vObj[fk], fShape, `${path}.${fk}`, (v) => {
            nested[fk] = v;
          });
        }
        return;
      }
      case 'array': {
        if (value === null || value === undefined) {
          assign(value);
          return;
        }
        if (!Array.isArray(value)) {
          assign(value);
          return;
        }
        const arr: unknown[] = [];
        assign(arr);
        for (let i = 0; i < value.length; i++) {
          const el = value[i];
          walkField(el, fieldShape.element, `${path}.${i}`, (v) => {
            arr[i] = v;
          });
        }
        return;
      }
      default: {
        fieldShape satisfies never;
        break;
      }
    }
  }

  for (const [k, fShape] of Object.entries(shape.fields)) {
    walkField(rowObj[k], fShape, k, (v) => {
      out[k] = v;
    });
  }

  await Promise.all(tasks);
  return out;
}
