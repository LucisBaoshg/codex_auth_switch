import type {
  CodexMessage,
  CodexSessionInfo,
} from "./session-utils";

export function createPreviewCodexSessions(nowMs: number): CodexSessionInfo[] {
  return [
    {
      id: "session-1",
      rolloutPath: "/Users/example/.codex/sessions/2026/05/21/rollout-1.jsonl",
      updatedAtMs: nowMs - 1000 * 60 * 10,
      cwd: "/Volumes/Acer/Dev/codex_auth_switch",
      title: "新增会话管理功能讨论",
      hasUserEvent: true,
      archived: false,
      modelProvider: "openai",
      fileSize: 12048,
    },
    {
      id: "session-2",
      rolloutPath: "/Users/example/.codex/sessions/2026/05/20/rollout-2.jsonl",
      updatedAtMs: nowMs - 1000 * 60 * 60 * 25,
      cwd: "/Volumes/Acer/Dev/another_project",
      title: "修复 Tailwind 样式错误",
      hasUserEvent: true,
      archived: false,
      modelProvider: "anthropic",
      fileSize: 4567,
    },
    {
      id: "session-3",
      rolloutPath: "/Users/example/.codex/archived_sessions/rollout-3.jsonl",
      updatedAtMs: nowMs - 1000 * 60 * 60 * 24 * 5,
      cwd: "/Volumes/Acer/Dev/codex_auth_switch",
      title: "旧的登录逻辑重构",
      hasUserEvent: true,
      archived: true,
      modelProvider: "openai",
      fileSize: 85930,
    },
  ];
}

export function createPreviewCodexSessionMessages(): CodexMessage[] {
  return [
    {
      role: "user",
      text: "我想给 app新增一个功能，就是 codex 会话管理，有什么建议没有",
    },
    {
      role: "assistant",
      text: "这是一个非常好的想法！Codex 的会话非常多，如果能提供会话列表、归档和物理删除功能，对管理磁盘空间 and 历史记录非常有帮助。以下是我的建议：\n\n1. 双栏布局：左侧是会话列表，可以按更新时间或工作空间目录分组；右侧是消息预览。\n2. 重命名：可以调用 SQLite 和 `session_index.jsonl` 同步更新会话标题。\n3. 归档与删除：归档移动到 `archived_sessions/` 目录，删除则物理删除 rollout 文件并从 SQLite 中删除。",
    },
  ];
}
