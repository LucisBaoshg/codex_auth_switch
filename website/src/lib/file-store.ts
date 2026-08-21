import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const lockTimeoutMs = 10_000;
const staleLockMs = 30_000;

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function ensureFile(filePath: string, initialContent: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    const handle = await fs.open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(initialContent, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
}

export async function atomicWriteFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    const handle = await fs.open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }

  try {
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => undefined);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function removeStaleLock(lockPath: string) {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs > staleLockMs) {
      await fs.unlink(lockPath);
      return true;
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    throw error;
  }
  return false;
}

export async function withFileStoreLock<T>(storePath: string, operation: () => Promise<T>): Promise<T> {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const lockPath = `${storePath}.lock`;
  const deadline = Date.now() + lockTimeoutMs;
  let lockHandle: Awaited<ReturnType<typeof fs.open>> | null = null;

  while (!lockHandle) {
    try {
      const candidate = await fs.open(lockPath, "wx", 0o600);
      try {
        await candidate.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf-8");
        lockHandle = candidate;
      } catch (error) {
        await candidate.close().catch(() => undefined);
        await fs.unlink(lockPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (!(await removeStaleLock(lockPath))) {
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for file store lock: ${path.basename(storePath)}`);
        }
        await delay(10 + Math.floor(Math.random() * 20));
      }
    }
  }

  try {
    return await operation();
  } finally {
    await lockHandle.close().catch(() => undefined);
    await fs.unlink(lockPath).catch(() => undefined);
  }
}
