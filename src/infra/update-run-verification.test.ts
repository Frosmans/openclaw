import { describe, expect, it } from "vitest";
import {
  areUpdateRunVerificationChecksHealthy,
  isUpdateRunVerificationHealthy,
} from "./update-run-verification.js";

describe("update run verification", () => {
  it("treats required unknown, failed, and skipped checks as unhealthy", () => {
    expect(
      areUpdateRunVerificationChecksHealthy([
        { id: "optional", status: "skipped", required: false },
        { id: "required", status: "unknown" },
      ]),
    ).toBe(false);
    expect(areUpdateRunVerificationChecksHealthy([{ id: "required", status: "pass" }])).toBe(true);
  });

  it("requires a successful normal cycle in addition to serving readiness", () => {
    const verification = {
      serviceRunning: true,
      versionMatch: true,
      settled: true,
      readyz: true,
      channelsReady: true,
      pluginErrors: [],
    };
    expect(isUpdateRunVerificationHealthy(verification)).toBe(false);
    expect(
      isUpdateRunVerificationHealthy({
        ...verification,
        checks: [{ id: "recall", status: "pass", observedAtMs: 10 }],
        normalCycle: { status: "pass", observedAtMs: 20 },
      }),
    ).toBe(true);
  });
});
