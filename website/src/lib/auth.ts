import { promises as fs } from "fs";
import crypto from "crypto";
import path from "path";
import type { NextRequest } from "next/server";
import { getDataDir } from "./data-paths";
import type { ProfilePrincipal } from "./profile-store";

export const sessionCookieName = "codex_share_session";
const desktopTokensFileName = "desktop-tokens.json";
const desktopLoginSessionsFileName = "desktop-login-sessions.json";
const canonicalCodexHost = "codex-helper.ite.tool4seller.com";
const legacyCodexHost = "sub2api.ite.tapcash.com";

type DesktopTokenRecord = {
  id: string;
  name: string;
  tokenHash: string;
  principal: ProfilePrincipal;
  createdAt: string;
  lastUsedAt?: string;
};

type DesktopLoginSessionRecord = {
  id: string;
  pollTokenHash: string;
  createdAt: string;
  expiresAt: string;
  principal?: ProfilePrincipal;
  token?: string;
  completedAt?: string;
  consumedAt?: string;
};

function sessionSecret() {
  return process.env.CODEX_SHARE_SESSION_SECRET || process.env.SSO_CLIENT_SECRET || "dev-only-session-secret";
}

function desktopTokensPath() {
  return path.join(getDataDir(), desktopTokensFileName);
}

function desktopLoginSessionsPath() {
  return path.join(getDataDir(), desktopLoginSessionsFileName);
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(value: string) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

export function createSessionCookieValue(principal: ProfilePrincipal) {
  const payload = base64UrlJson(principal);
  return `${payload}.${sign(payload)}`;
}

export function verifySessionCookieValue(value: string | undefined | null): ProfilePrincipal | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as ProfilePrincipal;
  } catch {
    return null;
  }
}

export function hashDesktopToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function ensureDesktopTokenStore() {
  await fs.mkdir(getDataDir(), { recursive: true });
  try {
    await fs.access(desktopTokensPath());
  } catch {
    await fs.writeFile(desktopTokensPath(), JSON.stringify([]));
  }
}

async function readDesktopTokenRecords(): Promise<DesktopTokenRecord[]> {
  await ensureDesktopTokenStore();
  const data = await fs.readFile(desktopTokensPath(), "utf-8");
  return JSON.parse(data) as DesktopTokenRecord[];
}

async function writeDesktopTokenRecords(records: DesktopTokenRecord[]) {
  await ensureDesktopTokenStore();
  await fs.writeFile(desktopTokensPath(), JSON.stringify(records, null, 2));
}

async function ensureDesktopLoginSessionStore() {
  await fs.mkdir(getDataDir(), { recursive: true });
  try {
    await fs.access(desktopLoginSessionsPath());
  } catch {
    await fs.writeFile(desktopLoginSessionsPath(), JSON.stringify([]));
  }
}

async function readDesktopLoginSessions(): Promise<DesktopLoginSessionRecord[]> {
  await ensureDesktopLoginSessionStore();
  const data = await fs.readFile(desktopLoginSessionsPath(), "utf-8");
  return JSON.parse(data) as DesktopLoginSessionRecord[];
}

async function writeDesktopLoginSessions(records: DesktopLoginSessionRecord[]) {
  await ensureDesktopLoginSessionStore();
  await fs.writeFile(desktopLoginSessionsPath(), JSON.stringify(records, null, 2));
}

export async function createDesktopToken(principal: ProfilePrincipal, name = "Desktop client") {
  const token = `cas_${crypto.randomBytes(32).toString("base64url")}`;
  const now = new Date().toISOString();
  const record: DesktopTokenRecord = {
    id: crypto.randomUUID(),
    name,
    tokenHash: hashDesktopToken(token),
    principal,
    createdAt: now,
  };

  const records = await readDesktopTokenRecords();
  records.unshift(record);
  await writeDesktopTokenRecords(records);

  return { token, record: { ...record, tokenHash: undefined } };
}

export async function createDesktopLoginSession() {
  const pollToken = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const record: DesktopLoginSessionRecord = {
    id: crypto.randomUUID(),
    pollTokenHash: hashDesktopToken(pollToken),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
  };

  const records = (await readDesktopLoginSessions()).filter((candidate) => {
    return !candidate.consumedAt && new Date(candidate.expiresAt).getTime() > now;
  });
  records.unshift(record);
  await writeDesktopLoginSessions(records);
  return { id: record.id, pollToken, expiresAt: record.expiresAt };
}

export async function completeDesktopLoginSession(id: string | undefined | null, principal: ProfilePrincipal) {
  if (!id) return false;

  const records = await readDesktopLoginSessions();
  const record = records.find((candidate) => candidate.id === id);
  if (!record || record.consumedAt || new Date(record.expiresAt).getTime() <= Date.now()) return false;
  if (!record.token) {
    const { token } = await createDesktopToken(principal, "Desktop SSO login");
    record.token = token;
  }
  record.principal = principal;
  record.completedAt = new Date().toISOString();
  await writeDesktopLoginSessions(records);
  return true;
}

export async function consumeDesktopLoginToken(id: string, pollToken: string) {
  const records = await readDesktopLoginSessions();
  const record = records.find((candidate) => candidate.id === id);
  if (
    !record ||
    record.consumedAt ||
    record.pollTokenHash !== hashDesktopToken(pollToken) ||
    new Date(record.expiresAt).getTime() <= Date.now() ||
    !record.token ||
    !record.principal
  ) {
    return null;
  }

  record.consumedAt = new Date().toISOString();
  await writeDesktopLoginSessions(records);
  return { token: record.token, principal: record.principal };
}

export async function principalFromDesktopToken(token: string): Promise<ProfilePrincipal | null> {
  const tokenHash = hashDesktopToken(token.trim());
  const records = await readDesktopTokenRecords();
  const index = records.findIndex((record) => record.tokenHash === tokenHash);
  if (index === -1) return null;

  records[index].lastUsedAt = new Date().toISOString();
  await writeDesktopTokenRecords(records);
  return records[index].principal;
}

export async function principalFromRequest(request: NextRequest): Promise<ProfilePrincipal | null> {
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    return principalFromDesktopToken(bearer);
  }

  return verifySessionCookieValue(request.cookies.get(sessionCookieName)?.value);
}

export function requireSsoEnv() {
  const clientId = process.env.SSO_CLIENT_ID;
  const clientSecret = process.env.SSO_CLIENT_SECRET;
  const baseUrl = process.env.SSO_BASE_URL || "https://sso.tool4seller.com";
  const redirectUri = process.env.SSO_REDIRECT_URI ? normalizeSsoRedirectUri(process.env.SSO_REDIRECT_URI) : undefined;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("SSO_CLIENT_ID, SSO_CLIENT_SECRET, and SSO_REDIRECT_URI must be configured.");
  }

  return { clientId, clientSecret, baseUrl, redirectUri };
}

export function normalizeSsoRedirectUri(redirectUri: string) {
  try {
    const url = new URL(redirectUri);
    if (url.hostname === legacyCodexHost) {
      url.hostname = canonicalCodexHost;
      url.protocol = "https:";
      return url.toString();
    }
  } catch {
    return redirectUri;
  }

  return redirectUri;
}

export function secureCookiesForRedirectUri(redirectUri: string, nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv !== "production") return false;

  try {
    return new URL(redirectUri).protocol === "https:";
  } catch {
    return true;
  }
}
