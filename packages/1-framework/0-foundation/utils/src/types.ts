/** Flattens an intersection of mapped types into a single readable object type. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Collapses a union into the intersection of its members. */
export type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;
