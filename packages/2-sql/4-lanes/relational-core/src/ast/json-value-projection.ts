import type { JsonValue } from '@prisma-next/contract/types';
import type { CodecRef } from './codec-types';
import type {
  AnyParamRef,
  ColumnRef,
  ExpressionFolder,
  ExpressionRewriter,
  ProjectionExpr,
} from './types';

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function freezeJsonValue(value: JsonValue): void {
  if (value === null || typeof value !== 'object') {
    return;
  }

  if (isJsonArray(value)) {
    for (const item of value) {
      freezeJsonValue(item);
    }
  } else {
    for (const item of Object.values(value)) {
      freezeJsonValue(item);
    }
  }

  Object.freeze(value);
}

function frozenCodecRef(codec: CodecRef): CodecRef {
  const typeParams = codec.typeParams === undefined ? undefined : structuredClone(codec.typeParams);
  if (typeParams !== undefined) {
    freezeJsonValue(typeParams);
  }

  return Object.freeze({
    codecId: codec.codecId,
    ...(typeParams === undefined ? {} : { typeParams }),
    ...(codec.many === undefined ? {} : { many: codec.many }),
  });
}

abstract class JsonValueProjection {
  abstract readonly kind: string;
  readonly value: ProjectionExpr;

  protected constructor(value: ProjectionExpr) {
    this.value = value;
  }

  abstract accept<R>(visitor: JsonValueProjectionVisitor<R>): R;
  abstract rewrite(rewriter: ExpressionRewriter): AnyJsonValueProjection;

  fold<T>(folder: ExpressionFolder<T>): T {
    return this.value.fold(folder);
  }

  collectColumnRefs(): ColumnRef[] {
    return this.value.collectColumnRefs();
  }

  collectParamRefs(): AnyParamRef[] {
    return this.value.collectParamRefs();
  }

  protected freeze(): void {
    Object.freeze(this);
  }
}

export interface JsonValueProjectionVisitor<R> {
  codec(projection: CodecJsonValueProjection): R;
  native(projection: NativeJsonValueProjection): R;
  document(projection: JsonDocumentProjection): R;
}

export class CodecJsonValueProjection extends JsonValueProjection {
  readonly kind = 'codec' as const;
  readonly codec: CodecRef;

  constructor(value: ProjectionExpr, codec: CodecRef) {
    super(value);
    this.codec = frozenCodecRef(codec);
    this.freeze();
  }

  override accept<R>(visitor: JsonValueProjectionVisitor<R>): R {
    return visitor.codec(this);
  }

  override rewrite(rewriter: ExpressionRewriter): CodecJsonValueProjection {
    return new CodecJsonValueProjection(this.value.rewrite(rewriter), this.codec);
  }
}

export class NativeJsonValueProjection extends JsonValueProjection {
  readonly kind = 'native' as const;

  constructor(value: ProjectionExpr) {
    super(value);
    this.freeze();
  }

  override accept<R>(visitor: JsonValueProjectionVisitor<R>): R {
    return visitor.native(this);
  }

  override rewrite(rewriter: ExpressionRewriter): NativeJsonValueProjection {
    return new NativeJsonValueProjection(this.value.rewrite(rewriter));
  }
}

export class JsonDocumentProjection extends JsonValueProjection {
  readonly kind = 'document' as const;

  constructor(value: ProjectionExpr) {
    super(value);
    this.freeze();
  }

  override accept<R>(visitor: JsonValueProjectionVisitor<R>): R {
    return visitor.document(this);
  }

  override rewrite(rewriter: ExpressionRewriter): JsonDocumentProjection {
    return new JsonDocumentProjection(this.value.rewrite(rewriter));
  }
}

export type AnyJsonValueProjection =
  | CodecJsonValueProjection
  | NativeJsonValueProjection
  | JsonDocumentProjection;
