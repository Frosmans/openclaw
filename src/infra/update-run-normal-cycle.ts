import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db-contract.js";
import {
  executeExistingOpenClawStateRead,
  withArtifactPreservingStateReads,
} from "../state/openclaw-state-db-readonly.js";
import { captureOpenClawStateWorkerContext } from "../state/openclaw-state-worker-context.js";
import type { OpenClawStateWorkerContext } from "../state/openclaw-state-worker-context.types.js";
import { getUpdateRun, listUpdateRuns, recordUpdateRunVerification } from "./update-run-ledger.js";
import type { UpdateRunRecord } from "./update-run-record.js";
import { isUpdateRunVerificationConfirmed } from "./update-run-verification.js";
import { recordUpdateRunVerificationAsync } from "./update-run-write.async.js";

export const DEFAULT_UPDATE_NORMAL_CYCLE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type UpdateNormalCycleOptions = OpenClawStateDatabaseOptions & {
  nowMs?: number;
  maxAgeMs?: number;
  signal?: AbortSignal;
  context?: OpenClawStateWorkerContext;
};

function isAwaitingNormalCycle(run: UpdateRunRecord, nowMs: number, maxAgeMs: number): boolean {
  return (
    run.status === "succeeded" &&
    run.phase === "finished" &&
    run.finishedAtMs !== null &&
    nowMs - run.finishedAtMs >= 0 &&
    nowMs - run.finishedAtMs <= maxAgeMs &&
    isUpdateRunVerificationConfirmed(run.verification) &&
    run.verification.normalCycle?.status !== "pass"
  );
}

function findNormalCycleCandidate(
  options: UpdateNormalCycleOptions,
  nowMs: number,
  maxAgeMs: number,
): UpdateRunRecord | undefined {
  const runs = listUpdateRuns({ limit: 32 }, options);
  // Never promote an older run while a newer update is still active.
  if (runs.some((run) => run.status === "running")) {
    return undefined;
  }
  const candidate = runs.find((run) => run.status !== "skipped" && run.phase === "finished");
  return candidate && isAwaitingNormalCycle(candidate, nowMs, maxAgeMs) ? candidate : undefined;
}

/** Record the first successful scheduled heartbeat after the latest update. */
export function recordLatestUpdateRunNormalCycle(
  options: UpdateNormalCycleOptions = {},
): UpdateRunRecord | undefined {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_UPDATE_NORMAL_CYCLE_MAX_AGE_MS;
  const candidate = findNormalCycleCandidate(options, nowMs, maxAgeMs);
  if (!candidate) {
    return undefined;
  }
  return recordUpdateRunVerification(
    candidate.runId,
    { normalCycle: { status: "pass", observedAtMs: nowMs } },
    options,
  );
}

async function listUpdateRunsForNormalCycle(
  context: OpenClawStateWorkerContext,
  signal?: AbortSignal,
): Promise<UpdateRunRecord[]> {
  const reply = await withArtifactPreservingStateReads(() =>
    executeExistingOpenClawStateRead(
      { path: context.admission.databasePath, env: context.environment },
      { type: "updateRuns.list", input: { limit: 32 } },
      { context, signal, preferIndependentWarmRead: true },
    ),
  );
  if (!reply) {
    return [];
  }
  if (!reply.ok || reply.type !== "updateRuns.list") {
    throw new Error("Unexpected update run list result");
  }
  return reply.runs;
}

/** Worker-backed version used by the live Gateway callback. */
export async function recordLatestUpdateRunNormalCycleAsync(
  options: UpdateNormalCycleOptions = {},
): Promise<UpdateRunRecord | undefined> {
  const context = options.context ?? captureOpenClawStateWorkerContext(options);
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_UPDATE_NORMAL_CYCLE_MAX_AGE_MS;
  context.admission.assertCurrent();
  const runs = await listUpdateRunsForNormalCycle(context, options.signal);
  if (runs.some((run) => run.status === "running")) {
    return undefined;
  }
  const candidate = runs.find((run) => run.status !== "skipped" && run.phase === "finished");
  if (!candidate || !isAwaitingNormalCycle(candidate, nowMs, maxAgeMs)) {
    return undefined;
  }
  const assertCurrent = () => {
    context.admission.assertCurrent();
    options.signal?.throwIfAborted();
  };
  return await recordUpdateRunVerificationAsync(
    candidate.runId,
    { normalCycle: { status: "pass", observedAtMs: nowMs } },
    {
      ...options,
      context,
      assertCurrent,
    },
  );
}

/** Testable read path for callers that want to inspect the promotion candidate. */
export function getLatestUpdateRunAwaitingNormalCycle(
  options: UpdateNormalCycleOptions = {},
): UpdateRunRecord | undefined {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_UPDATE_NORMAL_CYCLE_MAX_AGE_MS;
  return findNormalCycleCandidate(options, nowMs, maxAgeMs);
}

export function recordUpdateRunNormalCycle(
  runId: string,
  options: UpdateNormalCycleOptions = {},
): UpdateRunRecord | undefined {
  const run = getUpdateRun(runId, options);
  if (!run) {
    return undefined;
  }
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_UPDATE_NORMAL_CYCLE_MAX_AGE_MS;
  if (!isAwaitingNormalCycle(run, nowMs, maxAgeMs)) {
    return run;
  }
  return recordUpdateRunVerification(
    runId,
    { normalCycle: { status: "pass", observedAtMs: nowMs } },
    options,
  );
}
