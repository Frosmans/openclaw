import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeRun } from "./update-run-codec.js";
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

  it("retains no optional checks when all retained slots are required", () => {
    const record = {
      status: "succeeded",
      verification: {
        checks: Array.from({ length: 32 }, (_, index) => ({
          id: `required-${index}`,
          status: "pass" as const,
          required: true,
        })),
      },
    } as Parameters<typeof recordUpdateRunVerificationCheckRecord>[0];

    recordUpdateRunVerificationCheckRecord(record, {
      id: "optional-diagnostic",
      status: "pass",
      required: false,
    });

    expect(record.verification.checks).toHaveLength(32);
    expect(record.verification.checks?.every((check) => check.required !== false)).toBe(true);
    expect(record.verification.checks?.some((check) => check.id === "optional-diagnostic")).toBe(
      false,
    );
  });

  it("preserves required check identities and statuses while bounding optional diagnostics", () => {
    const requiredChecks = Array.from({ length: 16 }, (_, index) => ({
      id: `required-${index}`,
      status: index % 2 === 0 ? ("pass" as const) : ("fail" as const),
      required: true,
    }));
    const record = {
      runId: randomUUID(),
      createdAtMs: 1,
      updatedAtMs: 1,
      trigger: "cli",
      phase: "finished",
      status: "succeeded",
      reason: null,
      origin: {},
      target: {},
      before: {},
      after: {},
      steps: [],
      verification: {
        checks: [
          ...requiredChecks,
          ...Array.from({ length: 16 }, (_, index) => ({
            id: `optional-${index}`,
            status: "unknown" as const,
            required: false,
            detail: "optional diagnostic ".repeat(50),
          })),
        ],
      },
      repair: [],
      confirmedAtMs: null,
      finishedAtMs: 2,
      downtimeMs: null,
    } as Parameters<typeof encodeRun>[0];

    const encoded = encodeRun(record, { env: { HOME: "/tmp/openclaw" } });
    const verification = JSON.parse(encoded.verification_json) as {
      checks: Array<{ id: string; status: string; required?: boolean }>;
    };

    expect(verification.checks).toEqual(
      expect.arrayContaining(
        requiredChecks.map(({ id, status, required }) => ({ id, status, required })),
      ),
    );
    expect(verification.checks.length).toBeGreaterThanOrEqual(requiredChecks.length);
    expect(verification.checks.length).toBeLessThanOrEqual(32);
  });

  it("rejects a required check set that cannot fit the verification byte bound", () => {
    const record = {
      runId: randomUUID(),
      createdAtMs: 1,
      updatedAtMs: 1,
      trigger: "cli",
      phase: "finished",
      status: "succeeded",
      reason: null,
      origin: {},
      target: {},
      before: {},
      after: {},
      steps: [],
      verification: {
        checks: Array.from({ length: 16 }, (_, index) => ({
          id: `${index}-`.padEnd(1024, "x"),
          status: "pass" as const,
          required: true,
        })),
      },
      repair: [],
      confirmedAtMs: null,
      finishedAtMs: 2,
      downtimeMs: null,
    } as Parameters<typeof encodeRun>[0];

    expect(() => encodeRun(record, { env: { HOME: "/tmp/openclaw" } })).toThrow(
      "Required update verification checks exceed their byte limit",
    );
  });
});
