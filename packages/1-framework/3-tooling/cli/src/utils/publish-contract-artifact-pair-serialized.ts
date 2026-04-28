import { publishContractArtifactPair } from './publish-contract-artifact-pair';

interface EmitOutputQueueState {
  nextGeneration: number;
  queue: Promise<unknown>;
}

const emitOutputQueues = new Map<string, EmitOutputQueueState>();

function getEmitOutputQueue(outputJsonPath: string): EmitOutputQueueState {
  const existing = emitOutputQueues.get(outputJsonPath);
  if (existing) {
    return existing;
  }

  const created: EmitOutputQueueState = {
    nextGeneration: 0,
    queue: Promise.resolve(),
  };
  emitOutputQueues.set(outputJsonPath, created);
  return created;
}

/**
 * Issues a monotonically increasing generation number for the given output path.
 *
 * Call this at the START of an emit request (before source resolution and the
 * `emit()` call), not at publish time. The generation reflects request order,
 * which — given that all in-tree contract source providers
 * (`prismaContract`, `typescriptContract`, `typescriptContractFromPath`)
 * capture their bytes synchronously inside `load()` — also reflects
 * byte-capture order. So a request issued later carries newer bytes, and the
 * supersession check correctly preserves the newer-bytes-on-disk invariant.
 *
 * Issuing at publish time instead would invert this: a slow emit that started
 * earlier (and therefore reads older source bytes) would receive a higher
 * generation than a fast emit started later, and the slower/older emit would
 * win the supersession check. That's a regression — do not move the call site.
 */
export function issueContractArtifactGeneration(outputJsonPath: string): number {
  const state = getEmitOutputQueue(outputJsonPath);
  state.nextGeneration += 1;
  return state.nextGeneration;
}

/**
 * Drops the queue state for a given output path. Long-lived hosts (Vite dev
 * server, watch-mode CLIs) should call this when they stop publishing to a
 * path, otherwise `emitOutputQueues` accumulates one entry per unique path
 * for the lifetime of the process.
 *
 * After disposal, the next `issueContractArtifactGeneration` call for the
 * same path starts a fresh queue at generation 1.
 *
 * Safe to call between publications. Calling while a publication for the
 * same path is in flight does not abort it; the in-flight publication keeps
 * its own captured `state` reference (so its supersession check still works
 * against any newer generation issued before disposal), but a *new* generation
 * issued after disposal starts at 1 and will not order correctly against the
 * in-flight publication. Hosts must guarantee no concurrent publication for
 * the path being disposed.
 */
export function disposeEmitOutputQueue(outputJsonPath: string): void {
  emitOutputQueues.delete(outputJsonPath);
}

function isSuperseded(state: EmitOutputQueueState, generation: number): boolean {
  return generation < state.nextGeneration;
}

function queueEmitWrite<T>(
  outputJsonPath: string,
  action: (state: EmitOutputQueueState) => Promise<T>,
): Promise<T> {
  const state = getEmitOutputQueue(outputJsonPath);
  const run = state.queue.then(
    () => action(state),
    () => action(state),
  );
  state.queue = run;
  return run;
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export async function publishContractArtifactPairSerialized({
  outputJsonPath,
  outputDtsPath,
  generation,
  signal,
  contractJson,
  contractDts,
}: {
  readonly outputJsonPath: string;
  readonly outputDtsPath: string;
  readonly generation: number;
  readonly signal?: AbortSignal;
  readonly contractJson: string;
  readonly contractDts: string;
}): Promise<'written' | 'superseded'> {
  return await queueEmitWrite(outputJsonPath, async (state) => {
    throwIfAborted(signal);

    if (isSuperseded(state, generation)) {
      return 'superseded';
    }

    const didPublish = await publishContractArtifactPair({
      outputJsonPath,
      outputDtsPath,
      contractJson,
      contractDts,
      publicationToken: String(generation),
      beforePublish: () => {
        throwIfAborted(signal);
        return !isSuperseded(state, generation);
      },
    });
    return didPublish ? 'written' : 'superseded';
  });
}
