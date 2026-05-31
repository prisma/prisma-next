// The judge-model boundary: every judge prompt-set calls into this interface,
// never the SDK directly. Tests inject a mock that returns canned structured
// text; the live adapter (`judge-model-sdk.ts`) is reached only behind `--live`
// + `CURSOR_API_KEY`. Mirrors the `CreateAgent` injection pattern in
// `run-one-brief.ts`, so module evaluation, typecheck, tests, and lint stay
// green without `@cursor/sdk` installed and without any real-dollar call.

export type JudgeModel = {
  /** Submit a fully-rendered grading prompt; return the model's raw text
   *  response. Parsing/validation is the caller's responsibility. */
  grade(prompt: string): Promise<string>;
};
