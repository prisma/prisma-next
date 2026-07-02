/**
 * REPL evaluation session. Input is TypeScript: esbuild strips types, then
 * the code runs inside a persistent `node:vm` context so top-level
 * `const`/`let`/`var` declarations survive across submissions (V8 keeps a
 * shared global lexical scope per context).
 *
 * Top-level `await` is handled with the same pragmatic split Node's own REPL
 * uses: `const x = await <expr>` is rewritten so the binding persists; other
 * awaited input runs inside an async IIFE.
 */
import { createContext, runInContext } from 'node:vm';
import { transform } from 'esbuild';

export type EvalResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

export interface ReplEvaluator {
  evaluate(code: string): Promise<EvalResult>;
  globalNames(): string[];
}

const AWAIT_DECLARATION = /^\s*(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(await\s[\s\S]+)$/;

/** Strips string literals and comments so keyword probes don't false-match. */
function stripLiterals(code: string): string {
  return code
    .replaceAll(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''")
    .replaceAll(/\/\/[^\n]*/g, '')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '');
}

function hasTopLevelAwait(code: string): boolean {
  return /\bawait\b/.test(stripLiterals(code));
}

function declaredNames(code: string): string[] {
  const names: string[] = [];
  for (const match of stripLiterals(code).matchAll(
    /(?:^|[;\n{(])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.push(match[1]!);
  }
  return names;
}

/**
 * Host-realm built-ins seeded into the vm context. The db client lives in the
 * host realm, so sharing these makes `instanceof Error`, promise adoption,
 * and console output behave the way users expect.
 */
const HOST_GLOBALS: Record<string, unknown> = {
  console,
  JSON,
  Math,
  Date,
  Error,
  TypeError,
  RangeError,
  Promise,
  Symbol,
  BigInt,
  URL,
  Array,
  Object,
  setTimeout,
  clearTimeout,
  structuredClone,
  performance,
  process,
  fetch,
};

export function createReplEvaluator(globals: Record<string, unknown>): ReplEvaluator {
  const context = createContext({ ...HOST_GLOBALS, ...globals });
  const userBindings = new Set<string>(Object.keys(globals));

  function run(code: string): unknown {
    return runInContext(code, context, { filename: 'repl' });
  }

  function runExpressionOrStatements(code: string): unknown {
    const looksLikeStatement =
      /^\s*(const|let|var|function|class|if|for|while|do|switch|try|return|throw|import|export)\b/.test(
        code,
      ) || /;\s*\S/.test(stripLiterals(code));
    if (!looksLikeStatement) {
      try {
        return run(`(${code}\n)`);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    return run(code);
  }

  async function evaluateTransformed(code: string): Promise<unknown> {
    if (!hasTopLevelAwait(code)) {
      const value = runExpressionOrStatements(code);
      for (const name of declaredNames(code)) userBindings.add(name);
      return value;
    }

    const declaration = code.match(AWAIT_DECLARATION);
    if (declaration) {
      const [, keyword, name, expression] = declaration;
      const value: unknown = await run(`(async () => (${expression}\n))()`);
      const holder = '__prismaNextReplAwaited';
      (context as Record<string, unknown>)[holder] = value;
      try {
        run(`${keyword} ${name} = ${holder}`);
        userBindings.add(name!);
      } finally {
        delete (context as Record<string, unknown>)[holder];
      }
      return value;
    }

    try {
      return await run(`(async () => (${code}\n))()`);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    return await run(`(async () => {${code}\n})()`);
  }

  return {
    async evaluate(code: string): Promise<EvalResult> {
      // Brace-first input parses as a block statement; try the expression
      // reading first (`{ a: 1 }` is an object literal), like Node's REPL.
      const candidates = /^\s*\{[\s\S]*\}\s*$/.test(code) ? [`(${code})`, code] : [code];
      let lastError: unknown;
      for (const candidate of candidates) {
        try {
          const stripped = await transform(candidate, {
            loader: 'ts',
            format: 'esm',
            target: 'node22',
          });
          const value = await evaluateTransformed(stripped.code.trim().replace(/;$/, ''));
          return { ok: true, value };
        } catch (error) {
          lastError = error;
          const syntaxError =
            error instanceof SyntaxError ||
            (error instanceof Error && error.message.includes('Transform failed'));
          if (!syntaxError) break;
        }
      }
      return { ok: false, error: lastError };
    },

    globalNames(): string[] {
      return [...userBindings];
    },
  };
}
