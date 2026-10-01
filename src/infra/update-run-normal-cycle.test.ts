import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  closeOpenClawStateDatabaseAsync,
  closeOpenClawStateDatabaseForTest,
} from "../state/openclaw-state-db.js";
import {
  createUpdateRun,
  finishUpdateRun,
  getUpdateRun,
  recordUpdateRunVerification,
} from "./update-run-ledger.js";
import { recordLatestUpdateRunNormalCycleAsync } from "./update-run-normal-cycle.js";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  vi.restoreAllMocks();
  await closeOpenClawStateDatabaseAsync();
  closeOpenClawStateDatabaseForTest();
  tempDirs.cleanup();
});

describe("worker-backed normal-cycle promotion", () => {
  it("persists the scheduled-cycle receipt through the state worker", async () => {
    const options = { env: { OPENCLAW_STATE_DIR: tempDirs.make("openclaw-normal-cycle-") } };
    const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const run = createUpdateRun({ trigger: "cli" }, options);
    recordUpdateRunVerification(
      run.runId,
      {
        serviceRunning: true,
        versionMatch: true,
        settled: true,
        readyz: true,
        channelsReady: true,
        pluginErrors: [],
      },
      options,
    );
    finishUpdateRun(run.runId, { status: "succeeded" }, options);

    const promoted = await recordLatestUpdateRunNormalCycleAsync({ ...options, nowMs: 11_000 });

    expect(promoted).toMatchObject({
      runId: run.runId,
      verification: { normalCycle: { status: "pass", observedAtMs: 11_000 } },
    });
    expect(getUpdateRun(run.runId, options)?.verification.normalCycle).toEqual({
      status: "pass",
      observedAtMs: 11_000,
    });
    clock.mockRestore();
  });
});
