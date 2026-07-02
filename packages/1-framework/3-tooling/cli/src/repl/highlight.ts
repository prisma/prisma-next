/**
 * Lightweight syntax highlighting for the REPL input line. Token-level
 * regex colorization — no parser, ANSI-safe (plain text round-trips when
 * codes are stripped).
 */
import { replPalette } from './palette';

const { cyan, dim, green, magenta, yellow } = replPalette(true);

const TOKEN =
  /(?<string>'(?:\\.|[^'\\])*'?|"(?:\\.|[^"\\])*"?|`(?:\\.|[^`\\])*`?)|(?<comment>\/\/[^\n]*)|(?<number>\b\d[\w.]*\b)|(?<keyword>\b(?:const|let|var|await|async|function|return|new|typeof|true|false|null|undefined)\b)|(?<member>(?<=\.)[A-Za-z_$][\w$]*)/g;

export function highlightCode(code: string, color: boolean): string {
  if (!color) return code;
  return code.replaceAll(TOKEN, (match, ...args) => {
    const groups = args[args.length - 1] as Record<string, string | undefined>;
    if (groups['string'] !== undefined) return green(match);
    if (groups['comment'] !== undefined) return dim(match);
    if (groups['number'] !== undefined) return yellow(match);
    if (groups['keyword'] !== undefined) return magenta(match);
    return cyan(match);
  });
}
