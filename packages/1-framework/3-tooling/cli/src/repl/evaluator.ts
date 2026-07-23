/**
 * REPL evaluation session. Input is TypeScript: esbuild strips types, then
 * the code runs inside a persistent `node:vm` context so top-level
 * `const`/`let`/`var` declarations survive across submissions (V8 keeps a
 * shared global lexical scope per context).
 *
 * Syntax-form decisions (expression vs statement, await wrapping) are made
 * with host-side compile probes (`new Script(...)`) rather than by catching
 * evaluation errors: vm errors are context-realm objects that fail host
 * `instanceof` checks, and probing avoids re-executing side-effecting code
 * on fallback paths.
 */
import { createContext, runInContext, Script } from 'node:vm';
import { transform } from 'esbuild';
import { scanSource } from './scan';

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

/** True when the source compiles as a script (checked host-side; syntax validity is realm-independent). */
function compiles(source: string): boolean {
  try {
    new Script(source);
    return true;
  } catch {
    return false;
  }
}

function isSyntaxErrorLike(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; message?: unknown };
  if (candidate.name === 'SyntaxError') return true;
  // esbuild transform failures are host Errors with this message prefix.
  return typeof candidate.message === 'string' && candidate.message.includes('Transform failed');
}

/**
 * Walks the code outside strings/comments, invoking the callback at every
 * top-level (bracket depth 0) statement-ish keyword position. The callback
 * returns how many characters it consumed (0 = not handled).
 */
function rewriteAtTopLevel(
  code: string,
  handle: (rest: string, emit: (text: string) => void) => number,
): string {
  const mask = scanSource(code).mask;
  let depth = 0;
  let out = '';
  let i = 0;
  while (i < code.length) {
    const ch = code[i]!;
    if (!mask[i]) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      const atWordStart = /[A-Za-z]/.test(ch) && (i === 0 || !/[\w$.]/.test(code[i - 1]!));
      if (depth === 0 && atWordStart) {
        let emitted = '';
        const consumed = handle(code.slice(i), (text) => {
          emitted += text;
        });
        if (consumed > 0) {
          out += emitted;
          i += consumed;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Rewrites top-level declarations into assignments so bindings persist when
 * the code must run inside an async IIFE (top-level await path). Identifier
 * `const`/`let`/`var` lose their keyword; function/class declarations become
 * named assignments. Destructuring declarations are left untouched (they
 * stay IIFE-scoped).
 */
function rewriteTopLevelDeclarations(code: string): string {
  return rewriteAtTopLevel(code, (rest, emit) => {
    const decl = rest.match(/^(?:const|let|var)\s+(?=[A-Za-z_$])/);
    if (decl) return decl[0].length;
    const asyncFn = rest.match(/^async\s+function\s+([A-Za-z_$][\w$]*)/);
    if (asyncFn) {
      emit(`${asyncFn[1]} = async function ${asyncFn[1]}`);
      return asyncFn[0].length;
    }
    const fn = rest.match(/^function\s+([A-Za-z_$][\w$]*)/);
    if (fn) {
      emit(`${fn[1]} = function ${fn[1]}`);
      return fn[0].length;
    }
    const cls = rest.match(/^class\s+([A-Za-z_$][\w$]*)/);
    if (cls) {
      emit(`${cls[1]} = class ${cls[1]}`);
      return cls[0].length;
    }
    return 0;
  });
}

/** Names bound by top-level declarations, including simple destructuring patterns. */
function declaredNames(code: string): string[] {
  const names: string[] = [];
  rewriteAtTopLevel(code, (rest) => {
    const decl = rest.match(/^(?:const|let|var)\s+([^=;\n]+)/);
    if (decl) {
      // Binding list up to the initializer: `{ a: b }` binds b, plain `a` binds a.
      for (const part of decl[1]!.split(',')) {
        const ids = part.match(/[A-Za-z_$][\w$]*/g);
        if (ids && ids.length > 0) names.push(ids[ids.length - 1]!);
      }
      return decl[0].length;
    }
    const fn = rest.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (fn) {
      names.push(fn[1]!);
      return fn[0].length;
    }
    const cls = rest.match(/^class\s+([A-Za-z_$][\w$]*)/);
    if (cls) {
      names.push(cls[1]!);
      return cls[0].length;
    }
    return 0;
  });
  return names;
}

/**
 * Host globals seeded into the vm context. Only non-intrinsic Node globals
 * belong here: seeding intrinsics (Array, Object, Error, Promise, JSON, …)
 * would shadow the context realm's own and break `instanceof`/prototype
 * identity for values created inside the REPL.
 */
const HOST_GLOBALS: Record<string, unknown> = {
  console,
  process,
  Buffer,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  queueMicrotask,
  structuredClone,
  performance,
  fetch,
  crypto,
  AbortController,
  AbortSignal,
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
    const expressionForm = `(${code}\n)`;
    if (!looksLikeStatement && compiles(expressionForm)) {
      return run(expressionForm);
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
      const expressionForm = `(async () => (${expression}\n))()`;
      if (compiles(expressionForm)) {
        const value: unknown = await run(expressionForm);
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
      // Multi-statement input — fall through to the general await paths.
    }

    // Declaration-first input must not take the expression form: wrapping a
    // function/class declaration in parens turns it into an expression that
    // evaluates fine but binds nothing.
    const startsWithDeclaration = /^\s*(?:async\s+function|function|class|const|let|var)\b/.test(
      code,
    );
    const expressionForm = `(async () => (${code}\n))()`;
    if (!startsWithDeclaration && compiles(expressionForm)) {
      return await run(expressionForm);
    }

    // Statement form: rewrite top-level declarations to assignments so the
    // bindings escape the async IIFE and persist in the context.
    const rewritten = rewriteTopLevelDeclarations(code);
    const value = await run(`(async () => {${rewritten}\n})()`);
    for (const name of declaredNames(code)) userBindings.add(name);
    return value;
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
          if (!isSyntaxErrorLike(error)) break;
        }
      }
      return { ok: false, error: lastError };
    },

    globalNames(): string[] {
      return [...userBindings];
    },
  };
}
