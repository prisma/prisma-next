/**
 * Unified codec definitions for Postgres adapter.
 *
 * This file contains a single source of truth for all codec information:
 * - Scalar names
 * - Type IDs
 * - Codec implementations (runtime)
 * - Type information (compile-time)
 * - JS type mappings
 *
 * This structure is used both at runtime (to populate the registry) and
 * at compile time (to derive CodecTypes and ScalarToJs types).
 */

import type { Codec } from '@prisma-next/sql-target';

// Define codec implementations
const textCodec: Codec<string, string> = {
  id: 'pg/text@1',
  targetTypes: ['text'],
  decode(wire: string): string {
    return wire;
  },
  encode(value: string): string {
    return value;
  },
};

const int4Codec: Codec<number, number> = {
  id: 'pg/int4@1',
  targetTypes: ['int4'],
  decode(wire: number): number {
    return wire;
  },
  encode(value: number): number {
    return value;
  },
};

const int2Codec: Codec<number, number> = {
  id: 'pg/int2@1',
  targetTypes: ['int2'],
  decode(wire: number): number {
    return wire;
  },
  encode(value: number): number {
    return value;
  },
};

const int8Codec: Codec<number, number> = {
  id: 'pg/int8@1',
  targetTypes: ['int8'],
  decode(wire: number): number {
    return wire;
  },
  encode(value: number): number {
    return value;
  },
};

const float4Codec: Codec<number, number> = {
  id: 'pg/float4@1',
  targetTypes: ['float4'],
  decode(wire: number): number {
    return wire;
  },
  encode(value: number): number {
    return value;
  },
};

const float8Codec: Codec<number, number> = {
  id: 'pg/float8@1',
  targetTypes: ['float8'],
  decode(wire: number): number {
    return wire;
  },
  encode(value: number): number {
    return value;
  },
};

const timestampCodec: Codec<string | Date, string> = {
  id: 'pg/timestamp@1',
  targetTypes: ['timestamp'],
  decode(wire: string | Date): string {
    // If already a string (ISO format from DB), return as-is
    if (typeof wire === 'string') {
      return wire;
    }
    // If Date object, convert to ISO string
    if (wire instanceof Date) {
      return wire.toISOString();
    }
    // Fallback: convert to string
    return String(wire);
  },
  encode(value: string | Date): string {
    // If JS Date, convert to ISO string
    if (value instanceof Date) {
      return value.toISOString();
    }
    // If already a string, assume it's ISO format and return as-is
    if (typeof value === 'string') {
      return value;
    }
    // Fallback: convert to string
    return String(value);
  },
};

const timestamptzCodec: Codec<string | Date, string> = {
  id: 'pg/timestamptz@1',
  targetTypes: ['timestamptz'],
  decode(wire: string | Date): string {
    // If already a string (ISO format from DB), return as-is
    if (typeof wire === 'string') {
      return wire;
    }
    // If Date object, convert to ISO string
    if (wire instanceof Date) {
      return wire.toISOString();
    }
    // Fallback: convert to string
    return String(wire);
  },
  encode(value: string | Date): string {
    // If JS Date, convert to ISO string
    if (value instanceof Date) {
      return value.toISOString();
    }
    // If already a string, assume it's ISO format and return as-is
    if (typeof value === 'string') {
      return value;
    }
    // Fallback: convert to string
    return String(value);
  },
};

const boolCodec: Codec<boolean, boolean> = {
  id: 'pg/bool@1',
  targetTypes: ['bool'],
  decode(wire: boolean): boolean {
    return wire;
  },
  encode(value: boolean): boolean {
    return value;
  },
};

// Unified codec definitions - single source of truth
export const codecDefinitions = {
  text: {
    typeId: 'pg/text@1' as const,
    scalar: 'text' as const,
    codec: textCodec,
    input: undefined as unknown as string,
    output: undefined as unknown as string,
    jsType: undefined as unknown as string,
  },
  int4: {
    typeId: 'pg/int4@1' as const,
    scalar: 'int4' as const,
    codec: int4Codec,
    input: undefined as unknown as number,
    output: undefined as unknown as number,
    jsType: undefined as unknown as number,
  },
  int2: {
    typeId: 'pg/int2@1' as const,
    scalar: 'int2' as const,
    codec: int2Codec,
    input: undefined as unknown as number,
    output: undefined as unknown as number,
    jsType: undefined as unknown as number,
  },
  int8: {
    typeId: 'pg/int8@1' as const,
    scalar: 'int8' as const,
    codec: int8Codec,
    input: undefined as unknown as number,
    output: undefined as unknown as number,
    jsType: undefined as unknown as number,
  },
  float4: {
    typeId: 'pg/float4@1' as const,
    scalar: 'float4' as const,
    codec: float4Codec,
    input: undefined as unknown as number,
    output: undefined as unknown as number,
    jsType: undefined as unknown as number,
  },
  float8: {
    typeId: 'pg/float8@1' as const,
    scalar: 'float8' as const,
    codec: float8Codec,
    input: undefined as unknown as number,
    output: undefined as unknown as number,
    jsType: undefined as unknown as number,
  },
  timestamp: {
    typeId: 'pg/timestamp@1' as const,
    scalar: 'timestamp' as const,
    codec: timestampCodec,
    input: undefined as unknown as string | Date,
    output: undefined as unknown as string,
    jsType: undefined as unknown as string,
  },
  timestamptz: {
    typeId: 'pg/timestamptz@1' as const,
    scalar: 'timestamptz' as const,
    codec: timestamptzCodec,
    input: undefined as unknown as string | Date,
    output: undefined as unknown as string,
    jsType: undefined as unknown as string,
  },
  bool: {
    typeId: 'pg/bool@1' as const,
    scalar: 'bool' as const,
    codec: boolCodec,
    input: undefined as unknown as boolean,
    output: undefined as unknown as boolean,
    jsType: undefined as unknown as boolean,
  },
} as const;

// Derive dataTypes constant from codecDefinitions
export const dataTypes = {
  text: codecDefinitions.text.typeId,
  int4: codecDefinitions.int4.typeId,
  int2: codecDefinitions.int2.typeId,
  int8: codecDefinitions.int8.typeId,
  float4: codecDefinitions.float4.typeId,
  float8: codecDefinitions.float8.typeId,
  timestamp: codecDefinitions.timestamp.typeId,
  timestamptz: codecDefinitions.timestamptz.typeId,
  bool: codecDefinitions.bool.typeId,
} as const;

// Type helper to extract typeId values from codecDefinitions
type TypeIdOf<T> = T extends { typeId: infer Id } ? Id : never;
type CodecTypeIds = TypeIdOf<(typeof codecDefinitions)[keyof typeof codecDefinitions]>;

// Helper type to ensure all keys from codecDefinitions are present
type EnsureAllCodecKeys<
  T extends Record<CodecTypeIds, { readonly input: unknown; readonly output: unknown }>,
> = T;

// Derive CodecTypes type from codecDefinitions
export type CodecTypes = EnsureAllCodecKeys<{
  readonly [K in keyof typeof codecDefinitions as (typeof codecDefinitions)[K]['typeId']]: {
    readonly input: (typeof codecDefinitions)[K]['input'];
    readonly output: (typeof codecDefinitions)[K]['output'];
  };
}>;

// Helper type to ensure all scalar keys from codecDefinitions are present
type EnsureAllScalarKeys<T extends Record<keyof typeof codecDefinitions, unknown>> = T;

// Derive ScalarToJs type from codecDefinitions
export type ScalarToJs = EnsureAllScalarKeys<{
  readonly [K in keyof typeof codecDefinitions]: (typeof codecDefinitions)[K]['jsType'];
}>;
