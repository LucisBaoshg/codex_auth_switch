import {
  buildCodexSessionMarkdown,
  type CodexMessage,
  type CodexSessionInfo,
} from "./session-utils";

export function exportCodexSessionToMarkdown(session: CodexSessionInfo, messages: CodexMessage[]): void {
  const markdown = buildCodexSessionMarkdown(session, messages);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.setAttribute("href", url);
  link.setAttribute("download", `codex-session-${session.id}.md`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
