import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db-contract.js";
import { getUpdateRun, listUpdateRuns, recordUpdateRunVerification } from "./update-run-ledger.js";
import type { UpdateRunRecord } from "./update-run-record.js";
import { isUpdateRunVerificationConfirmed } from "./update-run-verification.js";

export const DEFAULT_UPDATE_NORMAL_CYCLE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type UpdateNormalCycleOptions = OpenClawStateDatabaseOptions & {
  nowMs?: number;
  maxAgeMs?: number;
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
