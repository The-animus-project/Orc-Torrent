// ui/desktop/scripts/build.ts

import { spawnSync, execSync, type SpawnSyncOptions } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, rmSync, statSync } from "node:fs";
import { join, resolve, dirname, isAbsolute, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// scripts/ is inside ui/desktop/scripts
const projectRoot = resolve(__dirname, "..");        // ui/desktop
const repoRoot = resolve(projectRoot, "..", "..");   // repo root
const isWin = process.platform === "win32";

// Configuration constants
const CONFIG = {
  RETRY_BACKOFF_MS: 750,
  MAX_RETRY_BACKOFF_MS: 3000,
  COMMAND_CHECK_TIMEOUT: 5000,
  BINARY_WAIT_ATTEMPTS: 5,
  BINARY_WAIT_INITIAL_MS: 200,
  COPY_RETRY_ATTEMPTS: 3,
  COPY_RETRY_INITIAL_MS: 300,
} as const;

type Tools = { vite: string; tsc: string };

interface Prerequisite {
  cmd: string;
  name: string;
  installUrl: string;
}

interface ShOpts extends SpawnSyncOptions {
  retries?: number;
  label?: string;
  retryBackoffMs?: number;
}

interface BuildStats {
  startTime: number;
  steps: Array<{ name: string; duration: number }>;
}

// -------------------
// Utility Functions
// -------------------

function sleepSync(ms: number): void {
  try {
    if (typeof (Atomics as any)?.wait === "function") {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      return;
    }
  } catch {
    // ignore
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // fallback (rare)
  }
}

function resolveCmd(cmd: string): string {
  if (isAbsolute(cmd)) return cmd;
  if (!isWin) return cmd;
  if (cmd === "npm") return `${cmd}.cmd`;
  return cmd;
}

function localBin(tool: string): string {
  const ext = isWin ? ".cmd" : "";
  return join(projectRoot, "node_modules", ".bin", `${tool}${ext}`);
}

function isCompileError(resolvedCmd: string, status: number): boolean {
  if (status === 0) return false;
  const tool = basename(resolvedCmd).toLowerCase();
  return tool.startsWith("vite") || tool.startsWith("tsc");
}

function escapeArg(arg: string): string {
  if (arg.includes(" ") || arg.includes("&") || arg.includes("|") || arg.includes(">") || arg.includes("<") || arg.includes('"')) {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return arg;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatPath(path: string): string {
  try {
    return relative(projectRoot, path);
  } catch {
    return path;
  }
}

// -------------------
// Command Execution
// -------------------

function sh(cmd: string, args: string[] = [], opts: ShOpts = {}): void {
  const { retries = 0, label, retryBackoffMs = CONFIG.RETRY_BACKOFF_MS, ...spawnOpts } = opts;

  const resolved = resolveCmd(cmd);
  const cwd = (spawnOpts.cwd as string | undefined) || projectRoot;
  const isCmdFile = isWin && (resolved.endsWith(".cmd") || resolved.endsWith(".bat"));

  let lastStatus = 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(retryBackoffMs * attempt, CONFIG.MAX_RETRY_BACKOFF_MS);
      console.log(`   WARNING: Retry attempt ${attempt}/${retries}${label ? ` (${label})` : ""}...`);
      sleepSync(backoff);
    }

    try {
      if (isCmdFile) {
        // Windows .cmd/.bat files need execSync for proper path handling
        const quotedPath = `"${resolved}"`;
        const escapedArgs = args.map(escapeArg);
        const command = escapedArgs.length > 0 
          ? `${quotedPath} ${escapedArgs.join(" ")}` 
          : quotedPath;
        
        // Only pass execSync-compatible options
        const execOpts: { stdio: "inherit"; cwd: string; env: NodeJS.ProcessEnv; timeout?: number } = {
          stdio: "inherit",
          cwd,
          env: process.env,
        };
        if (spawnOpts.timeout !== undefined) {
          execOpts.timeout = spawnOpts.timeout;
        }
        
        execSync(command, execOpts);
        return; // Success
      } else {
        // Use spawnSync for other commands
        const r = spawnSync(resolved, args, {
          stdio: "inherit",
          shell: false,
          cwd,
          env: process.env,
          ...spawnOpts,
        } as SpawnSyncOptions);

        const status = r.status ?? 1;
        lastStatus = status;

        if (status === 0) return;

        if (r.error) {
          lastError = r.error;
          if (attempt < retries) continue; // Retry on spawn errors
          console.error(`\nERROR: Failed to spawn: ${resolved}`);
          console.error(`   ${r.error.message}`);
          console.error(`   cwd: ${formatPath(cwd)}`);
          console.error(`   args: ${args.join(" ")}`);
          process.exit(1);
        }

        if (isCompileError(resolved, status)) {
          console.error(`\nERROR: Compilation error detected (no retry).`);
          process.exit(status);
        }
      }
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      const status = error.status ?? 1;
      lastStatus = status;

      if (status === 0) return;

      if (isCompileError(resolved, status)) {
        console.error(`\nERROR: Compilation error detected (no retry).`);
        process.exit(status);
      }

      if (attempt >= retries) {
        console.error(`\nERROR: Command failed after ${retries + 1} attempt(s): ${cmd} ${args.join(" ")}`);
        console.error(`   Resolved command: ${resolved}`);
        console.error(`   Working directory: ${formatPath(cwd)}`);
        console.error(`   Args: ${args.join(" ")}`);
        if (error.message) {
          console.error(`   Error: ${error.message}`);
        }
        process.exit(status);
      }
    }
  }

  // Should never reach here, but handle it gracefully
  console.error(`\nERROR: Command failed after ${retries + 1} attempt(s): ${cmd} ${args.join(" ")}`);
  console.error(`   Resolved command: ${resolved}`);
  console.error(`   Working directory: ${formatPath(cwd)}`);
  process.exit(lastStatus);
}

// -------------------
// Prerequisites Check
// -------------------

function checkCommand(cmd: string, args: string[] = ["--version"]): boolean {
  if (isWin && cmd === "npm") {
    try {
      const escapedArgs = args.map(escapeArg);
      const command = `npm ${escapedArgs.join(" ")}`;
      execSync(command, {
        stdio: "pipe",
        timeout: CONFIG.COMMAND_CHECK_TIMEOUT,
      });
      return true;
    } catch {
      return false;
    }
  }
  
  const resolved = resolveCmd(cmd);
  try {
    const r = spawnSync(resolved, args, {
      stdio: "pipe",
      shell: false,
      timeout: CONFIG.COMMAND_CHECK_TIMEOUT,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function printVersion(cmd: string, name: string): void {
  try {
    let version = "unknown";
    
    if (isWin && cmd === "npm") {
      const output = execSync("npm --version", {
        stdio: "pipe",
        timeout: CONFIG.COMMAND_CHECK_TIMEOUT,
        encoding: "utf8",
      });
      version = output.toString().trim() || "unknown";
    } else {
      const resolved = resolveCmd(cmd);
      const r = spawnSync(resolved, ["--version"], {
        stdio: "pipe",
        shell: false,
        timeout: CONFIG.COMMAND_CHECK_TIMEOUT,
        encoding: "utf8",
      });
      version = (r.stdout || "").toString().trim() || "unknown";
    }
    
    console.log(`   OK ${name}: ${version}`);
  } catch {
    console.log(`   WARNING: ${name}: version check failed`);
  }
}

function useExistingDaemonBinary(): boolean {
  if (process.env.ORC_USE_EXISTING_DAEMON !== "1") return false;
  const exeName = isWin ? "orc-daemon.exe" : "orc-daemon";
  const path = join(projectRoot, "assets", "bin", exeName);
  return existsSync(path);
}

function verifyPrerequisites(): void {
  console.log("Verifying prerequisites...\n");

  const skipCargo = useExistingDaemonBinary();
  if (skipCargo) {
    console.log("   OK Using existing daemon binary (ORC_USE_EXISTING_DAEMON=1)");
  }

  const prerequisites: Prerequisite[] = [
    { cmd: "cargo", name: "Rust/Cargo", installUrl: "https://rustup.rs/" },
    { cmd: "node", name: "Node.js", installUrl: "https://nodejs.org/" },
    { cmd: "npm", name: "npm", installUrl: "https://nodejs.org/" },
  ];

  let allPresent = true;

  for (const p of prerequisites) {
    if (p.cmd === "cargo" && skipCargo) continue;
    if (!checkCommand(p.cmd)) {
      console.log(`   ERROR: ${p.name}: not found`);
      console.log(`      Install from: ${p.installUrl}`);
      allPresent = false;
      continue;
    }
    printVersion(p.cmd, p.name);
  }

  if (!allPresent) {
    console.error("\nERROR: Missing prerequisites. Install the required tools before building.");
    process.exit(1);
  }

  console.log("");
}

// -------------------
// Node Dependencies
// -------------------

function ensureNodeDeps(): Tools {
  const vite = localBin("vite");
  const tsc = localBin("tsc");

  if (!existsSync(vite) || !existsSync(tsc)) {
    console.error("\nERROR: Node dependencies are missing or incomplete.");
    console.error(process.env.CI ? "   Run: npm ci" : "   Run: npm install");
    console.error(`   Expected: ${formatPath(vite)}`);
    console.error(`   Expected: ${formatPath(tsc)}`);
    process.exit(1);
  }

  if (isWin) {
    console.log("   Resolved tool paths:");
    console.log(`      vite: ${formatPath(vite)}`);
    console.log(`      tsc:  ${formatPath(tsc)}`);
  }

  return { vite, tsc };
}

// -------------------
// Build Artifacts Management
// -------------------

function cleanBuildArtifacts(): void {
  const clean = process.env.CLEAN === "1" || process.env.CLEAN === "true";
  if (!clean) return;

  console.log("\nCleaning build artifacts...");

  const pathsToClean = [
    join(projectRoot, "dist", "renderer"),
    join(projectRoot, "dist", "main"),
    join(projectRoot, "dist", "preload"),
    join(projectRoot, "assets", "bin"),
  ];

  let cleanedCount = 0;
  for (const p of pathsToClean) {
    if (existsSync(p)) {
      try {
        rmSync(p, { recursive: true, force: true });
        console.log(`   Removed: ${formatPath(p)}`);
        cleanedCount++;
      } catch (err) {
        console.error(`   WARNING: Failed to remove: ${formatPath(p)}`);
        console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (cleanedCount === 0) {
    console.log("   INFO: No build artifacts to clean.");
  }

  console.log("");
}

function verifyBuildOutput(path: string, description: string): void {
  if (!existsSync(path)) {
    console.error(`\nERROR: Build output verification failed: ${description}`);
    console.error(`   Expected: ${formatPath(path)}`);
    process.exit(1);
  }
  
  try {
    const stats = statSync(path);
    if (stats.isFile() && stats.size === 0) {
      console.error(`\nERROR: Build output is empty: ${description}`);
      console.error(`   Path: ${formatPath(path)}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`\nERROR: Failed to verify build output: ${description}`);
    console.error(`   Path: ${formatPath(path)}`);
    console.error(`   Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// -------------------
// Build Steps
// -------------------

function buildRustDaemon(stats: BuildStats): void {
  const stepStart = Date.now();
  if (useExistingDaemonBinary()) {
    console.log("\nUsing existing daemon binary (ORC_USE_EXISTING_DAEMON=1)...");
    const exeName = isWin ? "orc-daemon.exe" : "orc-daemon";
    const targetBinaryPath = join(projectRoot, "assets", "bin", exeName);
    verifyBuildOutput(targetBinaryPath, "Existing daemon binary");
    const duration = Date.now() - stepStart;
    stats.steps.push({ name: "Rust daemon (existing)", duration });
    console.log(`   Skipped rebuild in ${formatDuration(duration)}`);
    return;
  }

  console.log("\nBuilding Rust daemon...");

  if (!checkCommand("cargo")) {
    console.error("\nERROR: Rust/Cargo is not installed or not in PATH.");
    console.error("   Install Rust from: https://rustup.rs/");
    process.exit(1);
  }

  const cargoDir = join(repoRoot, "crates");
  if (!existsSync(cargoDir)) {
    console.error(`\nERROR: Cargo directory not found: ${formatPath(cargoDir)}`);
    process.exit(1);
  }

  const isDebug = process.env.BUILD_MODE === "debug";
  const buildArgs = isDebug
    ? ["build", "-p", "orc-daemon"]
    : ["build", "--release", "-p", "orc-daemon"];

  console.log(`   Running: cargo ${buildArgs.join(" ")}`);
  sh("cargo", buildArgs, { cwd: cargoDir, retries: 2, label: "cargo build" });

  const exeName = isWin ? "orc-daemon.exe" : "orc-daemon";
  const buildType = isDebug ? "debug" : "release";
  const rustBinaryPath = join(cargoDir, "target", buildType, exeName);

  // Wait for binary to appear (Cargo may take a moment to finish writing)
  let binaryExists = false;
  for (let i = 0; i < CONFIG.BINARY_WAIT_ATTEMPTS; i++) {
    if (existsSync(rustBinaryPath)) {
      binaryExists = true;
      break;
    }
    sleepSync(CONFIG.BINARY_WAIT_INITIAL_MS * (i + 1));
  }

  if (!binaryExists) {
    console.error(`\nERROR: Rust binary not found at expected path:`);
    console.error(`   ${formatPath(rustBinaryPath)}`);
    console.error(`   Build type: ${buildType}`);
    process.exit(1);
  }

  verifyBuildOutput(rustBinaryPath, "Rust daemon binary");

  // Copy binary to assets directory
  const assetsBinDir = join(projectRoot, "assets", "bin");
  if (!existsSync(assetsBinDir)) {
    mkdirSync(assetsBinDir, { recursive: true });
    console.log(`   Created directory: ${formatPath(assetsBinDir)}`);
  }

  const targetBinaryPath = join(assetsBinDir, exeName);

  let copySuccess = false;
  for (let i = 0; i < CONFIG.COPY_RETRY_ATTEMPTS; i++) {
    try {
      copyFileSync(rustBinaryPath, targetBinaryPath);
      verifyBuildOutput(targetBinaryPath, "Copied daemon binary");
      console.log(`   Copied daemon binary to: ${formatPath(targetBinaryPath)}`);
      copySuccess = true;
      break;
    } catch (err) {
      if (i === CONFIG.COPY_RETRY_ATTEMPTS - 1) {
        console.error(`\nERROR: Failed to copy daemon binary after ${CONFIG.COPY_RETRY_ATTEMPTS} attempts`);
        console.error(`   Source: ${formatPath(rustBinaryPath)}`);
        console.error(`   Target: ${formatPath(targetBinaryPath)}`);
        console.error(`   Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
      sleepSync(CONFIG.COPY_RETRY_INITIAL_MS * (i + 1));
    }
  }

  if (!copySuccess) {
    console.error(`\nERROR: Failed to copy daemon binary`);
    process.exit(1);
  }

  const duration = Date.now() - stepStart;
  stats.steps.push({ name: "Rust daemon", duration });
  console.log(`   Completed in ${formatDuration(duration)}`);
}

function buildRenderer(vite: string, stats: BuildStats): void {
  const stepStart = Date.now();
  console.log("\nBuilding Electron renderer...");
  sh(vite, ["build"], { retries: 1, label: "vite build" });
  
  // Verify renderer build output
  const rendererDist = join(projectRoot, "dist", "renderer");
  if (existsSync(rendererDist)) {
    console.log(`   Renderer build output: ${formatPath(rendererDist)}`);
  }
  
  const duration = Date.now() - stepStart;
  stats.steps.push({ name: "Electron renderer", duration });
  console.log(`   Completed in ${formatDuration(duration)}`);
}

function compileTypeScript(tsc: string, stats: BuildStats): void {
  const stepStart = Date.now();
  console.log("\nCompiling TypeScript...");
  
  const tsConfigs = [
    { file: "tsconfig.main.json", name: "main" },
    { file: "tsconfig.preload.json", name: "preload" },
  ];

  for (const config of tsConfigs) {
    const configStart = Date.now();
    sh(tsc, ["-p", config.file], { retries: 1, label: `tsc ${config.name}` });
    
    // Verify TypeScript output
    const outDir = config.name === "main" ? "dist/main" : "dist/preload";
    const outPath = join(projectRoot, outDir);
    if (existsSync(outPath)) {
      console.log(`   ${config.name} compiled: ${formatPath(outPath)}`);
    }
  }
  
  const duration = Date.now() - stepStart;
  stats.steps.push({ name: "TypeScript compilation", duration });
  console.log(`   Completed in ${formatDuration(duration)}`);
}

// -------------------
// Main Build Process
// -------------------

function main(): void {
  const stats: BuildStats = {
    startTime: Date.now(),
    steps: [],
  };

  console.log("Starting build process...\n");

  try {
    verifyPrerequisites();
    cleanBuildArtifacts();

    const tools = ensureNodeDeps();

    buildRustDaemon(stats);
    buildRenderer(tools.vite, stats);
    compileTypeScript(tools.tsc, stats);

    const totalDuration = Date.now() - stats.startTime;
    
    console.log("\n" + "=".repeat(60));
    console.log("Build complete! Ready for packaging.");
    console.log("=".repeat(60));
    console.log("\nBuild Statistics:");
    console.log(`   Total time: ${formatDuration(totalDuration)}`);
    stats.steps.forEach(step => {
      console.log(`   ${step.name}: ${formatDuration(step.duration)}`);
    });
    console.log("\nNext step: Run 'npm run dist' to create the installer.\n");
  } catch (err) {
    console.error("\nERROR: Build failed with error:");
    console.error(`   ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.error(`\nStack trace:\n${err.stack}`);
    }
    process.exit(1);
  }
}

main();
