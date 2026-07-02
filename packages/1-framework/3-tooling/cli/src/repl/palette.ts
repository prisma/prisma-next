/**
 * Shared REPL color palette. The session resolves color once (TTY,
 * --color/--no-color via parseGlobalFlags) and that decision is
 * authoritative: the palette must not silently defer to NO_COLOR, which
 * vitest sets globally, so the base colors are created with useColor
 * forced on and gated by the `color` argument instead.
 */
import { createColors } from 'colorette';

const colors = createColors({ useColor: true });

export interface ReplPalette {
  readonly bold: (text: string) => string;
  readonly cyan: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly green: (text: string) => string;
  readonly magenta: (text: string) => string;
  readonly yellow: (text: string) => string;
  readonly red: (text: string) => string;
  readonly bgCyan: (text: string) => string;
  readonly black: (text: string) => string;
}

const identity = (text: string): string => text;

const COLORED: ReplPalette = {
  bold: colors.bold,
  cyan: colors.cyan,
  dim: colors.dim,
  green: colors.green,
  magenta: colors.magenta,
  yellow: colors.yellow,
  red: colors.red,
  bgCyan: colors.bgCyan,
  black: colors.black,
};

const PLAIN: ReplPalette = {
  bold: identity,
  cyan: identity,
  dim: identity,
  green: identity,
  magenta: identity,
  yellow: identity,
  red: identity,
  bgCyan: identity,
  black: identity,
};

export function replPalette(color: boolean): ReplPalette {
  return color ? COLORED : PLAIN;
}
