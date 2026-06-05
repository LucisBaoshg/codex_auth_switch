import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const formatterImportPath = `../src/${"usage-formatters"}`;

test("formats profile labels and profile categories", async () => {
  expect(existsSync(join(root, "src/usage-formatters.ts"))).toBe(true);
  const { isOfficialOauthProfile, isThirdPartyBackedProfile, profileTypeLabel } = await import(formatterImportPath);

  expect(profileTypeLabel({ authTypeLabel: "共生配置", modelProviderName: "YLS Code" })).toBe(
    "共生配置 · YLS Code",
  );
  expect(profileTypeLabel({ authTypeLabel: "第三方 API", modelProviderKey: "openai" })).toBe("openai");
  expect(isOfficialOauthProfile({ authTypeLabel: "官方 OAuth" })).toBe(true);
  expect(isThirdPartyBackedProfile({ authTypeLabel: "共生配置" })).toBe(true);
  expect(isThirdPartyBackedProfile({ authTypeLabel: "官方 OAuth" })).toBe(false);
});

test("formats codex usage windows and latency values", async () => {
  expect(existsSync(join(root, "src/usage-formatters.ts"))).toBe(true);
  const { formatLatencyDuration, formatPlanTitle, formatUsageReset, remainingPercent, selectUsageWindow } =
    await import(formatterImportPath);
  const primary = { usedPercent: 12.7, windowMinutes: 300, resetsAt: "2026-06-05T10:30:00.000Z" };
  const weekly = { usedPercent: 101, windowMinutes: 10080, resetsAt: null };

  expect(selectUsageWindow({ primary, secondary: weekly }, 10080, false)).toBe(weekly);
  expect(remainingPercent(primary.usedPercent)).toBe(87);
  expect(remainingPercent(140)).toBe(0);
  expect(formatPlanTitle("pro")).toBe("Codex Pro Plan");
  expect(formatPlanTitle(null)).toBe("Codex Plan");
  expect(formatUsageReset(null)).toBe("--");
  expect(formatLatencyDuration(-50)).toBe("0.00s");
  expect(formatLatencyDuration(1234)).toBe("1.23s");
});

test("formats third-party quota values", async () => {
  expect(existsSync(join(root, "src/usage-formatters.ts"))).toBe(true);
  const {
    formatQuotaCurrency,
    formatQuotaCurrencyCompact,
    formatQuotaPercent,
    formatThirdPartyUsageAmount,
    quotaPercent,
  } = await import(formatterImportPath);

  expect(formatThirdPartyUsageAmount({ remaining: "42", unit: "credits" })).toBe("42 credits");
  expect(formatThirdPartyUsageAmount(null)).toBe("--");
  expect(quotaPercent({ used: "25", total: "100" })).toBe(25);
  expect(quotaPercent({ usedPercent: 120, used: "25", total: "100" })).toBe(100);
  expect(formatQuotaPercent({ used: "1", total: "3" })).toBe("33%");
  expect(formatQuotaCurrency("12.3")).toBe("$12.30");
  expect(formatQuotaCurrencyCompact("12.00")).toBe("$12");
});
