import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const utilsImportPath = `../src/${"session-recovery-utils"}`;

function createReport(overrides = {}) {
  return {
    codexHome: "/tmp/codex",
    dbPath: "/tmp/codex/sessions.db",
    sessionIndexPath: "/tmp/codex/session-index.json",
    recentLimit: 100,
    sqliteIntegrity: "ok",
    counts: {
      sessionIndexEntries: 0,
      dbThreads: 0,
      archived: 0,
      unarchived: 0,
      hasUserEventTrue: 0,
      hasUserEventFalse: 0,
    },
    repairCandidates: {
      missingRolloutFiles: 0,
      hasUserEventFalseButRolloutHasUserMessage: 0,
      dbTimeMismatchWithSessionIndex: 0,
      rolloutMtimeMismatchWithSessionIndex: 0,
      dbThreadIdsMissingFromSessionIndex: 0,
      sessionIndexIdsMissingFromDb: 0,
    },
    samples: {
      missingRolloutFiles: [],
      hasUserEventFalseButRolloutHasUserMessage: [],
      dbTimeMismatchWithSessionIndex: [],
      rolloutMtimeMismatchWithSessionIndex: [],
      savedRootsWithChatsOutsideRecentWindow: [],
    },
    notes: [],
    ...overrides,
  };
}

test("counts safe and time-based session repair candidates", async () => {
  expect(existsSync(join(root, "src/session-recovery-utils.ts"))).toBe(true);
  const { totalSafeRepairCandidates, totalTimeRepairCandidates } = await import(utilsImportPath);
  const report = createReport({
    repairCandidates: {
      missingRolloutFiles: 1,
      hasUserEventFalseButRolloutHasUserMessage: 2,
      dbTimeMismatchWithSessionIndex: 3,
      rolloutMtimeMismatchWithSessionIndex: 4,
      dbThreadIdsMissingFromSessionIndex: 5,
      sessionIndexIdsMissingFromDb: 6,
    },
  });

  expect(totalSafeRepairCandidates(report)).toBe(14);
  expect(totalTimeRepairCandidates(report)).toBe(7);
});

test("formats session recovery diagnosis flash messages", async () => {
  expect(existsSync(join(root, "src/session-recovery-utils.ts"))).toBe(true);
  const { formatSessionRecoveryFlash } = await import(utilsImportPath);

  expect(formatSessionRecoveryFlash(createReport())).toBe("诊断完成：未发现需要修复的会话索引问题。");
  expect(
    formatSessionRecoveryFlash(
      createReport({
        samples: {
          missingRolloutFiles: [],
          hasUserEventFalseButRolloutHasUserMessage: [],
          dbTimeMismatchWithSessionIndex: [],
          rolloutMtimeMismatchWithSessionIndex: [],
          savedRootsWithChatsOutsideRecentWindow: [
            { root: "/repo", latestThreadId: "t1", latestTitle: null, latestUpdatedAt: "2026-06-05" },
          ],
        },
      }),
    ),
  ).toBe("诊断完成：未发现真实索引损坏，但有 1 个旧项目落在 recent 窗口之外。");
  expect(
    formatSessionRecoveryFlash(
      createReport({
        repairCandidates: {
          missingRolloutFiles: 0,
          hasUserEventFalseButRolloutHasUserMessage: 0,
          dbTimeMismatchWithSessionIndex: 0,
          rolloutMtimeMismatchWithSessionIndex: 0,
          dbThreadIdsMissingFromSessionIndex: 0,
          sessionIndexIdsMissingFromDb: 0,
          appDefaultModelProviderMismatch: 2,
        },
      }),
    ),
  ).toContain("2 条活跃会话的 model provider");
});

test("formats session repair result flash messages", async () => {
  expect(existsSync(join(root, "src/session-recovery-utils.ts"))).toBe(true);
  const { formatSessionRepairFlash } = await import(utilsImportPath);

  expect(formatSessionRepairFlash({ repaired: false, note: "无需修复", backupPath: "", auditPath: "", updates: {} }, false)).toBe(
    "无需修复",
  );
  expect(
    formatSessionRepairFlash(
      {
        repaired: true,
        backupPath: "/tmp/backup",
        auditPath: "/tmp/audit",
        note: "",
        updates: {
          hasUserEvent: 2,
          dbTime: 1,
          rolloutMtime: 0,
          timeMismatchesNotRepaired: 0,
          skippedMissingRolloutFiles: 0,
        },
      },
      false,
    ),
  ).toBe("安全修复已完成：has_user_event 2 项，数据库时间 1 项。");
  expect(
    formatSessionRepairFlash(
      {
        repaired: true,
        backupPath: "/tmp/backup",
        auditPath: "/tmp/audit",
        note: "",
        updates: {
          hasUserEvent: 0,
          dbTime: 0,
          rolloutMtime: 0,
          timeMismatchesNotRepaired: 0,
          skippedMissingRolloutFiles: 0,
        },
      },
      true,
    ),
  ).toBe("高级修复已完成：没有需要回写的时间戳。");
});
