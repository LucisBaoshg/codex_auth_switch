export const SESSION_CLEANUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const UNKNOWN_SESSION_SIZE_LABEL = "未知大小";
export const UNKNOWN_WORKSPACE_LABEL = "未指定工作空间";

export type CodexSessionInfo = {
  id: string;
  rolloutPath?: string | null;
  updatedAtMs: number;
  cwd?: string | null;
  title?: string | null;
  hasUserEvent: boolean;
  archived: boolean;
  modelProvider?: string | null;
  fileSize?: number | null;
};

export type CodexMessage = {
  role: string;
  text: string;
};

export type SessionWorkspaceLike = {
  cwd?: string | null;
};

export type SessionCleanupLike = SessionWorkspaceLike & {
  updatedAtMs: number;
  fileSize?: number | null;
};

export type InactiveSessionProject<T extends SessionCleanupLike> = {
  cwd: string;
  sessions: T[];
  lastActiveTime: number;
};

export function formatSessionFileSize(bytes?: number | null): string {
  if (bytes === undefined || bytes === null) return UNKNOWN_SESSION_SIZE_LABEL;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function groupSessionsByCwd<T extends SessionWorkspaceLike>(
  sessions: readonly T[],
): Record<string, T[]> {
  const groups: Record<string, T[]> = {};

  for (const session of sessions) {
    const cwd = session.cwd || UNKNOWN_WORKSPACE_LABEL;
    if (!groups[cwd]) groups[cwd] = [];
    groups[cwd].push(session);
  }

  return groups;
}

export function getInactiveSessionProjects<T extends SessionCleanupLike>(
  sessions: readonly T[],
  cutoffMs: number,
): InactiveSessionProject<T>[] {
  const groups = groupSessionsByCwd(sessions);
  const inactiveProjects: InactiveSessionProject<T>[] = [];

  for (const [cwd, groupSessions] of Object.entries(groups)) {
    const latestActive = Math.max(...groupSessions.map((session) => session.updatedAtMs));
    if (latestActive < cutoffMs) {
      inactiveProjects.push({
        cwd,
        sessions: groupSessions,
        lastActiveTime: latestActive,
      });
    }
  }

  return inactiveProjects.sort((left, right) => right.lastActiveTime - left.lastActiveTime);
}

export function getOldSessions<T extends { updatedAtMs: number }>(
  sessions: readonly T[],
  cutoffMs: number,
): T[] {
  return sessions
    .filter((session) => session.updatedAtMs < cutoffMs)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

export function buildCodexSessionMarkdown(
  session: CodexSessionInfo,
  messages: readonly CodexMessage[],
): string {
  let markdown = `# Codex Session: ${session.title || "Untitled Session"}\n`;
  markdown += `- **Session ID**: \`${session.id}\`\n`;
  markdown += `- **Directory**: \`${session.cwd || "N/A"}\`\n`;
  markdown += `- **Date**: ${new Date(session.updatedAtMs).toLocaleString()}\n`;
  markdown += `- **Model Provider**: \`${session.modelProvider || "unknown"}\`\n\n`;
  markdown += `---\n\n`;

  for (const message of messages) {
    const roleName = message.role === "user" ? "User" : "Codex";
    markdown += `### 👤 ${roleName}\n\n${message.text}\n\n`;
  }

  return markdown;
}
