import { spawn, spawnSync, ChildProcess, execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import process from "node:process";
import { syncAnimusBrandingAssets } from "./syncAnimusBranding.ts";

function run(cmd: string, args: string[] = [], opts: Record<string, unknown> = {}): ChildProcess {
  // On Windows, npx/npm commands need special handling
  // Using shell: true with args array causes deprecation warnings (DEP0190)
  // For async operations (dev server), we need spawn, but we need to handle .cmd files
  // On Windows, spawn with shell: false doesn't auto-resolve .cmd files, so we use execSync
  // with a command string for npm/npx to avoid deprecation warnings
  const isWin = process.platform === "win32";

  // For npm/npx on Windows, use execSync with command string (non-blocking is not critical here
  // as these are background processes started sequentially)
  if (isWin && (cmd === "npx" || cmd === "npm")) {
    // Escape args properly for Windows shell
    const escapedArgs = args.map((arg) => {
      if (/["\s&|><^%!()]/.test(arg)) {
        return `"${arg.replace(/%/g, "%%").replace(/"/g, '""')}"`;
      }
      return arg;
    });
    const command = `${cmd} ${escapedArgs.join(" ")}`;

    // For dev server, we still need async behavior, so spawn a process that runs execSync
    // Actually, let's use spawn with shell: true but pass command as a single string
    // This avoids the deprecation warning (DEP0190)
    const p = spawn(command, [], {
      stdio: "inherit",
      shell: true,
      ...opts,
    } as any);
    p.on("exit", (code) => {
      if (code && code !== 0) process.exit(code);
    });
    return p;
  }

  // For other commands, use spawn with shell: false for security
  const p = spawn(cmd, args, { stdio: "inherit", shell: false, ...opts } as any);
  p.on("exit", (code) => {
    if (code && code !== 0) process.exit(code);
  });
  return p;
}

async function waitFor(url: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const p = run("npx", ["wait-on", url]);
    p.on("exit", (code) => (code === 0 ? resolve(true) : reject(new Error(`wait-on failed (${code})`))));
  });
}

async function main(): Promise<void> {
  syncAnimusBrandingAssets();
  const processes: ChildProcess[] = [];
  const isWin = process.platform === "win32";
  const projectRoot = resolve(process.cwd());
  const repoRoot = resolve(projectRoot, "..", "..");
  const daemonName = isWin ? "orc-daemon.exe" : "orc-daemon";
  const daemonAssetPath = join(projectRoot, "assets", "bin", daemonName);

  // Helper to track and clean up processes
  const trackProcess = (p: ChildProcess): ChildProcess => {
    processes.push(p);
    p.on("exit", () => {
      const index = processes.indexOf(p);
      if (index > -1) processes.splice(index, 1);
    });
    return p;
  };

  // Ensure daemon exists for first-run dev on macOS/Linux.
  if (!existsSync(daemonAssetPath)) {
    console.log(`[dev] Missing daemon binary at ${daemonAssetPath}`);
    console.log("[dev] Building Rust daemon...");

    const cargoTarget = (process.env.ORC_DAEMON_CARGO_TARGET ?? process.env.CARGO_BUILD_TARGET)?.trim() || undefined;
    const cargoArgs = ["build", "--release"];
    if (cargoTarget) {
      cargoArgs.push("--target", cargoTarget);
      console.log(`[dev] Cargo target: ${cargoTarget}`);
    }
    cargoArgs.push("-p", "orc-daemon");
    const cargoResult = spawnSync("cargo", cargoArgs, {
      cwd: join(repoRoot, "crates"),
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    if ((cargoResult.status ?? 1) !== 0) {
      throw new Error("Failed to build Rust daemon for development");
    }

    const cratesTarget = join(repoRoot, "crates", "target");
    const daemonCandidates = cargoTarget
      ? [
          process.env.CARGO_TARGET_DIR ? join(process.env.CARGO_TARGET_DIR, cargoTarget, "release", daemonName) : null,
          join(cratesTarget, cargoTarget, "release", daemonName),
          join(repoRoot, "target", cargoTarget, "release", daemonName),
        ].filter((value): value is string => Boolean(value))
      : [
          process.env.CARGO_TARGET_DIR ? join(process.env.CARGO_TARGET_DIR, "release", daemonName) : null,
          join(cratesTarget, "release", daemonName),
          join(repoRoot, "target", "release", daemonName),
        ].filter((value): value is string => Boolean(value));
    const builtDaemonPath = daemonCandidates.find((candidate) => existsSync(candidate));
    if (!builtDaemonPath) {
      throw new Error(`Built daemon not found at: ${daemonCandidates.join(", ")}`);
    }

    mkdirSync(join(projectRoot, "assets", "bin"), { recursive: true });
    copyFileSync(builtDaemonPath, daemonAssetPath);
    console.log(`[dev] Copied daemon to ${daemonAssetPath}`);
  }

  // 1) Compile Electron main + preload in watch mode (so package.json "main" exists)
  const tscMain = trackProcess(run("npx", ["tsc", "-p", "tsconfig.main.json", "--watch", "--preserveWatchOutput"]));
  const tscPreload = trackProcess(
    run("npx", ["tsc", "-p", "tsconfig.preload.json", "--watch", "--preserveWatchOutput"])
  );

  // 2) Start Vite renderer
  const vite = trackProcess(run("npx", ["vite", "--port", "5173"]));

  // 3) Wait until renderer is up, then start Electron
  try {
    await waitFor("http://127.0.0.1:5173");
  } catch (error) {
    console.error("Failed to start Vite renderer:", error);
    // Clean up already started processes
    processes.forEach((p) => {
      try {
        p.kill("SIGINT");
      } catch {}
    });
    process.exit(1);
  }

  const electron = trackProcess(run("npx", ["electron", "."]));

  const shutdown = (): void => {
    console.log("\n🛑 Shutting down development server...");
    // Kill all tracked processes
    processes.forEach((p) => {
      try {
        p.kill("SIGINT");
      } catch {}
    });
    // Give processes a moment to clean up
    setTimeout(() => {
      // Force kill if still running
      processes.forEach((p) => {
        try {
          p.kill("SIGKILL");
        } catch {}
      });
      process.exit(0);
    }, 2000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    shutdown();
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    shutdown();
  });
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
