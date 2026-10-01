import { describe, expect, it } from "vitest";
import {
  areUpdateRunVerificationChecksHealthy,
  isUpdateRunVerificationHealthy,
  recordUpdateRunVerificationCheckRecord,
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

  it("retains required checks when optional diagnostics exceed the bound", () => {
    const record = {
      status: "succeeded",
      verification: {
        checks: Array.from({ length: 32 }, (_, index) => ({
          id: `optional-${index}`,
          status: "pass" as const,
          required: false,
        })),
      },
    } as Parameters<typeof recordUpdateRunVerificationCheckRecord>[0];

    recordUpdateRunVerificationCheckRecord(record, {
      id: "required-failure",
      status: "fail",
      required: true,
    });
    expect(record.verification.checks).toEqual([
      { id: "required-failure", status: "fail", required: true },
      ...Array.from({ length: 31 }, (_, index) => ({
        id: `optional-${index + 1}`,
        status: "pass" as const,
        required: false,
      })),
    ]);
  });
});
