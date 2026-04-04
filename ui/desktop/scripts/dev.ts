import { spawn, ChildProcess, execSync } from "node:child_process";
import process from "node:process";

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
    const escapedArgs = args.map(arg => {
      if (arg.includes(" ") || arg.includes("&") || arg.includes("|") || arg.includes(">") || arg.includes("<")) {
        return `"${arg.replace(/"/g, '\\"')}"`;
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
      ...opts 
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
  const processes: ChildProcess[] = [];
  
  // Helper to track and clean up processes
  const trackProcess = (p: ChildProcess): ChildProcess => {
    processes.push(p);
    p.on("exit", () => {
      const index = processes.indexOf(p);
      if (index > -1) processes.splice(index, 1);
    });
    return p;
  };

  // 1) Compile Electron main + preload in watch mode (so package.json "main" exists)
  const tscMain = trackProcess(run("npx", ["tsc", "-p", "tsconfig.main.json", "--watch", "--preserveWatchOutput"]));
  const tscPreload = trackProcess(run("npx", ["tsc", "-p", "tsconfig.preload.json", "--watch", "--preserveWatchOutput"]));

  // 2) Start Vite renderer
  const vite = trackProcess(run("npx", ["vite", "--port", "5173"]));

  // 3) Wait until renderer is up, then start Electron
  try {
    await waitFor("http://127.0.0.1:5173");
  } catch (error) {
    console.error("Failed to start Vite renderer:", error);
    // Clean up already started processes
    processes.forEach(p => {
      try { p.kill("SIGINT"); } catch {}
    });
    process.exit(1);
  }

  const electron = trackProcess(run("npx", ["electron", "."]));

  const shutdown = (): void => {
    console.log("\n🛑 Shutting down development server...");
    // Kill all tracked processes
    processes.forEach(p => {
      try { p.kill("SIGINT"); } catch {}
    });
    // Give processes a moment to clean up
    setTimeout(() => {
      // Force kill if still running
      processes.forEach(p => {
        try { p.kill("SIGKILL"); } catch {}
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
