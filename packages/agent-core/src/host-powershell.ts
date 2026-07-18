import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceRoot } from "./workspace-binding";
import {
  resolveWorkspacePath,
  WorkspacePathError,
} from "./workspace-paths";

export const POWERSHELL_DEFAULT_TIMEOUT_MS = 120_000;
export const POWERSHELL_MAX_TIMEOUT_MS = 600_000;
export const POWERSHELL_OUTPUT_LIMIT_BYTES = 512 * 1024;

export type PowerShellRunInput = {
  readonly command: string;
  /** 逻辑 cwd：/workspace/<alias>/... */
  readonly cwdLogical: string;
  readonly roots: readonly WorkspaceRoot[];
  readonly timeoutMs?: number;
  readonly abortSignal?: AbortSignal;
};

export type PowerShellRunResult = {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly logicalCwd: string;
  /** 实际 spawn 使用的宿主目录（审批预览同源 resolve）。 */
  readonly hostCwd: string;
  readonly timedOut: boolean;
};

export class PowerShellError extends Error {
  readonly code: "pwsh_missing" | "invalid_cwd" | "spawn_failed";

  constructor(code: PowerShellError["code"], message: string) {
    super(message);
    this.name = "PowerShellError";
    this.code = code;
  }
}

const PWSH_MISSING_MESSAGE =
  "未检测到 PowerShell 7（pwsh）。请安装 PowerShell 7，或设置环境变量 NIANAGENT_PWSH 指向 pwsh.exe 的绝对路径。禁止回退到 Windows PowerShell 5.1 或 Git Bash。";

export type PwshPreflightResult =
  | { readonly ok: true; readonly path: string; readonly major: number }
  | { readonly ok: false; readonly message: string };

function pwshCandidateBins(): string[] {
  const list: string[] = [];
  const envBin = process.env.NIANAGENT_PWSH?.trim();
  if (envBin) list.push(envBin);
  // 优先绝对路径：Windows 安装后常未进当前进程 PATH
  list.push(
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "PowerShell",
      "7",
      "pwsh.exe",
    ),
  );
  const pf86 = process.env["ProgramFiles(x86)"];
  if (pf86) {
    list.push(path.join(pf86, "PowerShell", "7", "pwsh.exe"));
  }
  list.push("pwsh");
  return list;
}

function looksLikeFilesystemPath(bin: string): boolean {
  return path.isAbsolute(bin) || bin.includes("/") || bin.includes("\\");
}

/**
 * 探测候选二进制是否可启动且主版本 ≥ 7（真实 spawn，不信任 PATH 字符串）。
 */
async function probePwshBinary(
  bin: string,
): Promise<{ path: string; major: number } | null> {
  if (looksLikeFilesystemPath(bin)) {
    try {
      await access(bin);
    } catch {
      return null;
    }
  }

  return await new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let child: ChildProcess;
    try {
      child = spawn(
        bin,
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$PSVersionTable.PSVersion.Major",
        ],
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        },
      );
    } catch {
      resolve(null);
      return;
    }

    const finish = (value: { path: string; major: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      killProcessTree(child);
      finish(null);
    }, 8_000);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(null);
        return;
      }
      const major = Number.parseInt(stdout.trim(), 10);
      if (!Number.isFinite(major) || major < 7) {
        finish(null);
        return;
      }
      finish({ path: bin, major });
    });
  });
}

/** 预检本机是否有可用的 PowerShell 7；不做 5.1 / Git Bash 回退。 */
export async function checkPwshAvailable(): Promise<PwshPreflightResult> {
  for (const bin of pwshCandidateBins()) {
    const hit = await probePwshBinary(bin);
    if (hit) {
      return { ok: true, path: hit.path, major: hit.major };
    }
  }
  return { ok: false, message: PWSH_MISSING_MESSAGE };
}

/** 预检本机是否有 pwsh（PowerShell 7）；失败抛 PowerShellError。 */
export async function assertPwshAvailable(): Promise<string> {
  const result = await checkPwshAvailable();
  if (!result.ok) {
    throw new PowerShellError("pwsh_missing", result.message);
  }
  return result.path;
}

function killProcessTree(child: ChildProcess): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* ignore */
  }
}

function collectLimited(
  stream: NodeJS.ReadableStream,
  limit: number,
): { text: () => string; truncated: () => boolean; stop: () => void } {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  const onData = (chunk: Buffer | string) => {
    if (truncated) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (total + buf.length > limit) {
      const remain = Math.max(0, limit - total);
      if (remain > 0) chunks.push(buf.subarray(0, remain));
      total = limit;
      truncated = true;
      return;
    }
    chunks.push(buf);
    total += buf.length;
  };
  stream.on("data", onData);
  return {
    text: () => Buffer.concat(chunks).toString("utf8"),
    truncated: () => truncated,
    stop: () => {
      stream.off("data", onData);
    },
  };
}

/**
 * 真实执行：`pwsh -NoLogo -NoProfile -NonInteractive -Command <获批命令>`。
 * cwd 必须已落在 binding root 内；超时/取消杀子进程树。
 */
export async function runHostPowerShell(
  input: PowerShellRunInput,
): Promise<PowerShellRunResult> {
  if (!input.command || !input.command.trim()) {
    throw new PowerShellError("spawn_failed", "PowerShell 命令不能为空。");
  }

  let resolved;
  try {
    resolved = await resolveWorkspacePath(input.cwdLogical, input.roots);
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      throw new PowerShellError(
        "invalid_cwd",
        `PowerShell cwd 非法：${err.message}`,
      );
    }
    throw err;
  }

  // cwd 必须是目录
  const { stat } = await import("node:fs/promises");
  try {
    const st = await stat(resolved.hostPath);
    if (!st.isDirectory()) {
      throw new PowerShellError(
        "invalid_cwd",
        `PowerShell cwd 不是目录：${input.cwdLogical}`,
      );
    }
  } catch (err) {
    if (err instanceof PowerShellError) throw err;
    throw new PowerShellError(
      "invalid_cwd",
      `PowerShell cwd 不存在：${input.cwdLogical}`,
    );
  }

  const timeoutMs = Math.min(
    Math.max(1, input.timeoutMs ?? POWERSHELL_DEFAULT_TIMEOUT_MS),
    POWERSHELL_MAX_TIMEOUT_MS,
  );

  const pwsh = await assertPwshAvailable();
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    input.command,
  ];

  return await new Promise<PowerShellRunResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(pwsh, args, {
        cwd: resolved.hostPath,
        env: process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reject(
        new PowerShellError(
          "pwsh_missing",
          `无法启动 pwsh（PowerShell 7）。请安装 PowerShell 7 并确保 pwsh 在 PATH 中。详情：${message}`,
        ),
      );
      return;
    }

    if (!child.stdout || !child.stderr) {
      reject(new PowerShellError("spawn_failed", "pwsh 未提供 stdout/stderr 管道。"));
      return;
    }
    const stdoutC = collectLimited(child.stdout, POWERSHELL_OUTPUT_LIMIT_BYTES);
    const stderrC = collectLimited(child.stderr, POWERSHELL_OUTPUT_LIMIT_BYTES);
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);

    const onAbort = () => {
      killProcessTree(child);
    };
    if (input.abortSignal) {
      if (input.abortSignal.aborted) onAbort();
      else input.abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdoutC.stop();
      stderrC.stop();
      input.abortSignal?.removeEventListener("abort", onAbort);
      reject(
        new PowerShellError(
          "pwsh_missing",
          `pwsh 启动失败：${err.message}。请安装 PowerShell 7（pwsh），禁止回退到 Windows PowerShell 5.1 或 Git Bash。`,
        ),
      );
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdoutC.stop();
      stderrC.stop();
      input.abortSignal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode: code,
        signal: signal,
        stdout: stdoutC.text(),
        stderr: stderrC.text(),
        stdoutTruncated: stdoutC.truncated(),
        stderrTruncated: stderrC.truncated(),
        logicalCwd: resolved.logicalPath,
        hostCwd: resolved.hostPath,
        timedOut,
      });
    });
  });
}
