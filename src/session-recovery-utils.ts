export type SessionRecoveryCounts = {
  sessionIndexEntries: number;
  dbThreads: number;
  archived: number;
  unarchived: number;
  hasUserEventTrue: number;
  hasUserEventFalse: number;
  inferredCurrentModelProvider?: string | null;
  modelProviderCounts?: Record<string, number>;
};

export type SessionRecoveryCandidates = {
  missingRolloutFiles: number;
  hasUserEventFalseButRolloutHasUserMessage: number;
  dbTimeMismatchWithSessionIndex: number;
  rolloutMtimeMismatchWithSessionIndex: number;
  dbThreadIdsMissingFromSessionIndex: number;
  sessionIndexIdsMissingFromDb: number;
  appDefaultModelProviderMismatch?: number;
};

export type SavedRootOutsideRecentWindowSample = {
  root: string;
  latestThreadId: string;
  latestTitle: string | null;
  latestUpdatedAt: string;
};

export type SessionRecoverySamples = {
  missingRolloutFiles: Array<{ id: string; archived: boolean; rolloutPath: string | null }>;
  hasUserEventFalseButRolloutHasUserMessage: Array<{
    id: string;
    archived: boolean;
    cwd: string | null;
    title: string | null;
  }>;
  dbTimeMismatchWithSessionIndex: Array<{
    id: string;
    cwd: string | null;
    dbUpdatedAtMs: number;
    indexedUpdatedAtMs: number;
  }>;
  rolloutMtimeMismatchWithSessionIndex: Array<{
    id: string;
    rolloutPath: string;
    rolloutMtimeMs: number;
    indexedUpdatedAtMs: number;
  }>;
  savedRootsWithChatsOutsideRecentWindow: SavedRootOutsideRecentWindowSample[];
};

export type SessionRecoveryReport = {
  codexHome: string;
  dbPath: string;
  sessionIndexPath: string;
  recentLimit: number;
  sqliteIntegrity: string;
  counts: SessionRecoveryCounts;
  repairCandidates: SessionRecoveryCandidates;
  samples: SessionRecoverySamples;
  notes: string[];
};

export type SessionRepairUpdateCounts = {
  hasUserEvent: number;
  dbTime: number;
  rolloutMtime: number;
  timeMismatchesNotRepaired: number;
  skippedMissingRolloutFiles: number;
};

export type SessionRepairResult = {
  repaired: boolean;
  backupPath: string;
  auditPath: string;
  updates: SessionRepairUpdateCounts;
  note: string;
};

export function totalSafeRepairCandidates(report: SessionRecoveryReport): number {
  return (
    report.repairCandidates.missingRolloutFiles +
    report.repairCandidates.hasUserEventFalseButRolloutHasUserMessage +
    report.repairCandidates.dbThreadIdsMissingFromSessionIndex +
    report.repairCandidates.sessionIndexIdsMissingFromDb
  );
}

export function totalTimeRepairCandidates(report: SessionRecoveryReport): number {
  return (
    report.repairCandidates.dbTimeMismatchWithSessionIndex +
    report.repairCandidates.rolloutMtimeMismatchWithSessionIndex
  );
}

export function formatSessionRecoveryFlash(report: SessionRecoveryReport): string {
  const safeCandidates = totalSafeRepairCandidates(report);
  const timeCandidates = totalTimeRepairCandidates(report);
  const providerMismatch = report.repairCandidates.appDefaultModelProviderMismatch ?? 0;
  const outsideRecent = report.samples.savedRootsWithChatsOutsideRecentWindow.length;

  if (safeCandidates === 0 && timeCandidates === 0 && providerMismatch === 0) {
    if (outsideRecent > 0) {
      return `诊断完成：未发现真实索引损坏，但有 ${outsideRecent} 个旧项目落在 recent 窗口之外。`;
    }
    return "诊断完成：未发现需要修复的会话索引问题。";
  }

  if (providerMismatch > 0) {
    return `诊断发现 ${providerMismatch} 条活跃会话的 model provider 与当前默认 provider 不一致。切换 profile 时会执行安全会话修复并同步 provider。`;
  }

  return `诊断完成：安全修复候选 ${safeCandidates} 项，时间修复候选 ${timeCandidates} 项。`;
}

export function formatSessionRepairFlash(result: SessionRepairResult, advanced: boolean): string {
  if (!result.repaired) {
    return result.note;
  }

  const updates = result.updates;
  const repairedSummary = [
    updates.hasUserEvent > 0 ? `has_user_event ${updates.hasUserEvent} 项` : null,
    updates.dbTime > 0 ? `数据库时间 ${updates.dbTime} 项` : null,
    updates.rolloutMtime > 0 ? `rollout mtime ${updates.rolloutMtime} 项` : null,
  ]
    .filter(Boolean)
    .join("，");

  return advanced
    ? `高级修复已完成：${repairedSummary || "没有需要回写的时间戳"}。`
    : `安全修复已完成：${repairedSummary || "没有需要落盘的修复项"}。`;
}
