import path from "path";

export function getDataDir() {
  return process.env.CODEX_PROFILE_DATA_DIR || path.join(process.cwd(), "data");
}
