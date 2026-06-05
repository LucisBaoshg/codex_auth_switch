export type CodexUsageWindow = {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: string | null;
};

export type CodexUsageCredits = {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
};

export type CodexUsageSnapshot = {
  source: string;
  planType: string | null;
  primary: CodexUsageWindow | null;
  secondary: CodexUsageWindow | null;
  credits: CodexUsageCredits | null;
  updatedAt: string;
  error?: string | null;
};

export type ThirdPartyLatencySnapshot = {
  wireApi: string | null;
  model: string | null;
  ttftMs: number | null;
  totalMs: number | null;
  statusCode: number | null;
  updatedAt: string;
  error: string | null;
};

export type ThirdPartyUsageSnapshot = {
  provider: string | null;
  remaining: string | null;
  unit: string | null;
  daily?: ThirdPartyUsageQuotaSnapshot | null;
  weekly?: ThirdPartyUsageQuotaSnapshot | null;
  subscription?: ThirdPartySubscriptionSnapshot | null;
  credit?: ThirdPartyCreditSnapshot | null;
  updatedAt: string;
  error: string | null;
};

export type ThirdPartyUsageQuotaSnapshot = {
  used: string | null;
  total: string | null;
  remaining: string | null;
  usedPercent: number | null;
};

export type ThirdPartySubscriptionSnapshot = {
  dailyQuota: string | null;
  weeklyQuota: string | null;
  monthlyQuota: string | null;
  expiresAt: string | null;
  amount: string | null;
  packageType: string | null;
};

export type ThirdPartyCreditSnapshot = {
  freeBalance: string | null;
  paidBalance: string | null;
  totalBalance: string | null;
};

export type ProfileRuntimeMeta = {
  authTypeLabel: string;
  modelProviderKey?: string | null;
  modelProviderName?: string | null;
  codexUsage?: CodexUsageSnapshot | null;
  thirdPartyUsage?: ThirdPartyUsageSnapshot | null;
  thirdPartyLatency?: ThirdPartyLatencySnapshot | null;
};

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "还没有";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function profileTypeLabel(profile: ProfileRuntimeMeta): string {
  const provider = profile.modelProviderKey?.trim() || profile.modelProviderName?.trim();
  if (profile.authTypeLabel === "共生配置" && provider) {
    return `共生配置 · ${provider}`;
  }
  if (profile.authTypeLabel === "第三方 API" && provider) {
    return provider;
  }
  return profile.authTypeLabel;
}

export function isOfficialOauthProfile(profile: Pick<ProfileRuntimeMeta, "authTypeLabel">): boolean {
  return profile.authTypeLabel === "官方 OAuth";
}

export function isThirdPartyBackedProfile(profile: Pick<ProfileRuntimeMeta, "authTypeLabel">): boolean {
  return profile.authTypeLabel === "第三方 API" || profile.authTypeLabel === "共生配置";
}

export function selectUsageWindow(
  usage: Pick<CodexUsageSnapshot, "primary" | "secondary"> | null,
  minutes: number,
  fallbackPrimary: boolean,
): CodexUsageWindow | null {
  if (!usage) {
    return null;
  }
  if (usage.primary?.windowMinutes === minutes) {
    return usage.primary;
  }
  if (usage.secondary?.windowMinutes === minutes) {
    return usage.secondary;
  }
  return fallbackPrimary ? usage.primary : usage.secondary;
}

export function remainingPercent(usedPercent: number): number {
  return Math.max(0, Math.min(100, Math.floor(100 - usedPercent)));
}

export function formatPlanTitle(planType: string | null): string {
  if (!planType) {
    return "Codex Plan";
  }

  const normalized = planType.charAt(0).toUpperCase() + planType.slice(1).toLowerCase();
  return `Codex ${normalized} Plan`;
}

export function formatUsageReset(window: Pick<CodexUsageWindow, "resetsAt"> | null): string {
  if (!window?.resetsAt) {
    return "--";
  }

  const resetAt = new Date(window.resetsAt);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(resetAt);
  const date = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(resetAt);
  return `${time} on ${date}`;
}

export function formatLatencyDuration(ms: number | null): string {
  if (ms == null) {
    return "--";
  }
  return `${(Math.max(0, ms) / 1000).toFixed(2)}s`;
}

export function formatThirdPartyUsageAmount(
  usage: Pick<ThirdPartyUsageSnapshot, "remaining" | "unit"> | null | undefined,
): string {
  if (!usage?.remaining) {
    return "--";
  }
  return [usage.remaining, usage.unit].filter(Boolean).join(" ");
}

export function parseQuotaNumber(value: string | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatQuotaCurrency(value: string | null | undefined): string {
  const parsed = parseQuotaNumber(value);
  return parsed == null ? "--" : `$${parsed.toFixed(2)}`;
}

export function clampQuotaPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

export function quotaPercent(quota: ThirdPartyUsageQuotaSnapshot | null | undefined): number | null {
  const explicit = clampQuotaPercent(quota?.usedPercent);
  if (explicit != null) {
    return explicit;
  }
  const used = parseQuotaNumber(quota?.used);
  const total = parseQuotaNumber(quota?.total);
  if (used == null || total == null || total <= 0) {
    return null;
  }
  return clampQuotaPercent((used / total) * 100);
}

export function formatQuotaPercent(quota: ThirdPartyUsageQuotaSnapshot | null | undefined): string {
  const percent = quotaPercent(quota);
  return percent == null ? "--" : `${Math.round(percent)}%`;
}

export function formatProfileSummary(profile: ProfileRuntimeMeta): string {
  if (isOfficialOauthProfile(profile)) {
    const usage = profile.codexUsage;
    if (usage?.error) {
      return "额度失败";
    }

    const primaryWindow = selectUsageWindow(usage ?? null, 300, true);
    const weeklyWindow = selectUsageWindow(usage ?? null, 10080, false);
    return `5H ${primaryWindow ? `${remainingPercent(primaryWindow.usedPercent)}%` : "--"} · WEEKLY ${weeklyWindow ? `${remainingPercent(weeklyWindow.usedPercent)}%` : "--"}`;
  }

  if (isThirdPartyBackedProfile(profile)) {
    const usage = profile.thirdPartyUsage;
    const probe = profile.thirdPartyLatency;
    return [
      `今日 ${formatQuotaCurrency(usage?.daily?.used)} / ${formatQuotaCurrency(usage?.daily?.total)}`,
      `本周 ${formatQuotaCurrency(usage?.weekly?.used)} / ${formatQuotaCurrency(usage?.weekly?.total)}`,
      `TTFT ${formatLatencyDuration(probe?.ttftMs ?? null)}`,
    ].join(" · ");
  }

  return "暂无摘要";
}

export function formatQuotaCurrencyCompact(value: string | null | undefined): string {
  const parsed = parseQuotaNumber(value);
  if (parsed == null) {
    return "--";
  }
  return `$${parsed.toFixed(2).replace(/\.00$/, "")}`;
}
