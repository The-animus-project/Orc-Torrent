// ui/desktop/scripts/dist.ts

import { spawnSync, execSync } from "node:child_process";
import { existsSync, rmSync, mkdtempSync, writeFileSync, symlinkSync, renameSync, copyFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = resolve(__dirname, "..");        // ui/desktop
const isWin = process.platform === "win32";

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

function getToolVersion(tool: string): string {
  try {
    // On Windows, use shell: true for npm to handle the .cmd shim properly
    const useShell = isWin && tool === "npm";
    const cmd = useShell ? "npm" : tool;
    const r = spawnSync(cmd, ["--version"], { 
      encoding: "utf8", 
      shell: useShell,
      stdio: "pipe",
    });
    if (r.status === 0 && r.stdout) {
      return r.stdout.toString().trim();
    }
  } catch {
    // Ignore errors
  }
  return "unknown";
}

function getElectronBuilderVersion(): string {
  try {
    const eb = localBin("electron-builder");
    if (!existsSync(eb)) return "not installed";
    const r = spawnSync(eb, ["--version"], { encoding: "utf8", shell: false, cwd: projectRoot });
    if (r.status === 0 && r.stdout) {
      return r.stdout.toString().trim();
    }
  } catch {
    // Ignore errors
  }
  return "unknown";
}

function printToolVersions(): void {
  console.log("Tool versions:");
  console.log(`  Node: ${process.version}`);
  console.log(`  npm: ${getToolVersion("npm")}`);
  console.log(`  electron-builder: ${getElectronBuilderVersion()}`);
  console.log();
}

function run(cmd: string, args: string[], cwd = projectRoot): void {
  const finalCmd = resolveCmd(cmd);
  
  // On Windows, npm needs shell to find its dependencies properly
  // Use execSync with a command string to avoid deprecation warning
  // (spawnSync with shell: true and args array is deprecated)
  if (isWin && cmd === "npm") {
    // Escape args properly for Windows shell
    const escapedArgs = args.map(arg => {
      // If arg contains spaces or special chars, wrap in quotes
      if (arg.includes(" ") || arg.includes("&") || arg.includes("|") || arg.includes(">") || arg.includes("<")) {
        // Escape any existing quotes and wrap
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    });
    const command = `npm ${escapedArgs.join(" ")}`;
    
    try {
      execSync(command, {
        stdio: "inherit",
        cwd,
        env: process.env,
      });
      return; // Success
    } catch (err: any) {
      const status = err.status ?? 1;
      console.error(`\nCommand failed: ${cmd} ${args.join(" ")}`);
      process.exit(status);
    }
  }
  
  // On Windows, .cmd files from node_modules must be executed via execSync for proper path handling
  const isCmdFile = isWin && (finalCmd.endsWith(".cmd") || finalCmd.endsWith(".bat"));
  
  if (isCmdFile) {
    const quotedPath = `"${finalCmd}"`;
    const command = args.length > 0 ? `${quotedPath} ${args.join(" ")}` : quotedPath;
    
    try {
      execSync(command, {
        stdio: "inherit",
        cwd,
        env: process.env,
      });
      return; // Success
    } catch (err: any) {
      const status = err.status ?? 1;
      console.error(`\nCommand failed: ${cmd} ${args.join(" ")}`);
      process.exit(status);
    }
  }
  
  // Normal spawnSync handling for non-.cmd files
  const r = spawnSync(finalCmd, args, {
    stdio: "inherit",
    shell: false,
    cwd,
    env: process.env,
  });

  if (r.status === 0) return;

  if (r.error) {
    console.error(`\nFailed to spawn: ${cmd}`);
    console.error(`   ${r.error.message}`);
    process.exit(1);
  }

  console.error(`\nERROR: Command failed: ${cmd} ${args.join(" ")}`);
  process.exit(r.status ?? 1);
}

function hasSymlinkPrivilege(): boolean {
  if (!isWin) return true;

  const dir = mkdtempSync(join(tmpdir(), "orc-symlink-test-"));
  const target = join(dir, "target.txt");
  const link = join(dir, "link.txt");

  try {
    writeFileSync(target, "test");
    symlinkSync(target, link);
    return true;
  } catch {
    return false;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function clearWinCodeSignCache(): void {
  if (!isWin) return;

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    console.warn("WARNING: LOCALAPPDATA is undefined, skipping winCodeSign cache clear");
    return;
  }

  const cacheDir = join(localAppData, "electron-builder", "Cache", "winCodeSign");
  if (existsSync(cacheDir)) {
    console.log("\nClearing winCodeSign cache...");
    rmSync(cacheDir, { recursive: true, force: true });
    console.log("   Cache cleared");
  }
}

/**
 * Find processes by ExecutablePath using PowerShell (more accurate than name-based).
 * Returns array of process information with name, pid, and path.
 */
type ProcessInfo = {
  name: string;
  pid: number;
  path?: string;
};

function findProcessesByExecutablePathPowerShell(targetPath: string): ProcessInfo[] {
  if (!isWin) return [];

  try {
    // Escape the path for PowerShell (replace backslashes and wrap in quotes)
    const escapedPath = targetPath.replace(/\\/g, "\\\\").replace(/'/g, "''");
    const psScript = `
      $targetPath = '${escapedPath}'
      $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { 
          $_.ExecutablePath -and 
          $_.ExecutablePath.StartsWith($targetPath, [System.StringComparison]::OrdinalIgnoreCase)
        }
      
      foreach ($proc in $procs) {
        Write-Output "$($proc.Name)|$($proc.ProcessId)|$($proc.ExecutablePath)"
      }
    `;

    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      psScript
    ], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
      timeout: 10000,
    });

    if (result.status === 0 && result.stdout) {
      const output = result.stdout.toString().trim();
      if (!output) return [];

      const processes: ProcessInfo[] = [];
      const lines = output.split("\n").filter(line => line.trim());

      for (const line of lines) {
        const parts = line.split("|");
        if (parts.length >= 2) {
          const name = parts[0] || "";
          const pid = parseInt(parts[1], 10) || 0;
          const path = parts[2] || undefined;

          if (name && pid > 0) {
            processes.push({ name, pid, path });
          }
        }
      }

      return processes;
    }
  } catch {
    // PowerShell detection failed, return empty array
  }

  return [];
}

/**
 * Check if ORC TORRENT.exe or orc-daemon.exe processes are running.
 * Also checks for Electron processes that might be holding file locks.
 * Optionally terminates processes if AUTO_KILL_PROCESSES environment variable is set.
 * 
 * When AUTO_KILL_PROCESSES=1, uses PowerShell to find processes by ExecutablePath
 * (more accurate than name-based detection, especially for processes running from
 * dist\win-unpacked which lock app.asar).
 */
function checkRunningProcesses(): void {
  if (!isWin) return;

  const autoKill = process.env.AUTO_KILL_PROCESSES === "1" || process.env.AUTO_KILL_PROCESSES === "true";
  const winUnpackedDir = join(projectRoot, "dist", "win-unpacked");

  // When auto-kill is enabled, use the more targeted ExecutablePath-based approach
  if (autoKill && existsSync(winUnpackedDir)) {
    try {
      const targetPath = resolve(winUnpackedDir);
      const procsByPath = findProcessesByExecutablePathPowerShell(targetPath);

      if (procsByPath.length > 0) {
        console.log("\nFound processes executing from dist\\win-unpacked:");
        procsByPath.forEach(proc => {
          console.log(`   - ${proc.name} (PID: ${proc.pid})`);
          if (proc.path) {
            console.log(`     Path: ${proc.path}`);
          }
        });

        console.log("\n🔪 Auto-terminating processes...");
        let killedCount = 0;

        for (const proc of procsByPath) {
          try {
            const killResult = spawnSync("taskkill", ["/F", "/PID", proc.pid.toString()], {
              encoding: "utf8",
              shell: false,
              stdio: "pipe",
            });

            if (killResult.status === 0) {
              console.log(`   Terminated: ${proc.name} (PID: ${proc.pid})`);
              killedCount++;
            } else {
              console.warn(`   WARNING: Failed to terminate: ${proc.name} (PID: ${proc.pid})`);
            }
          } catch (err) {
            console.warn(`   WARNING: Error terminating ${proc.name}: ${err}`);
          }
        }

        if (killedCount > 0) {
          console.log(`   Terminated ${killedCount} process(es). Waiting 2 seconds for file handles to release...\n`);
          sleepSync(2000);
          return; // Successfully handled, skip name-based fallback
        }
      }
    } catch {
      // PowerShell approach failed, fall back to name-based detection
      console.log("\nWARNING: PowerShell-based process detection failed, falling back to name-based detection...");
    }
  }

  const processes = ["ORC TORRENT.exe", "orc-daemon.exe", "electron.exe"];
  const running: string[] = [];

  for (const procName of processes) {
    try {
      // Use tasklist to check for running process
      // /FI filters, /NH removes header, /FO CSV outputs CSV format
      const r = spawnSync("tasklist", [
        "/FI", `IMAGENAME eq ${procName}`,
        "/NH",
        "/FO", "CSV"
      ], {
        encoding: "utf8",
        shell: false,
        stdio: "pipe",
      });

      if (r.status === 0 && r.stdout) {
        const output = r.stdout.toString().trim();
        // If process is found, CSV output contains the process name
        // Empty output means no process found
        if (output && output.length > 0 && output.includes(procName)) {
          running.push(procName);
        }
      }
    } catch {
      // Ignore errors - if tasklist fails, we can't check, so continue
    }
  }

  if (running.length > 0) {
    if (autoKill) {
      console.log("\n🔪 Auto-terminating locking processes...");
      let killedCount = 0;
      
      for (const proc of running) {
        try {
          const killResult = spawnSync("taskkill", ["/F", "/IM", proc], {
            encoding: "utf8",
            shell: false,
            stdio: "pipe",
          });
          
          if (killResult.status === 0) {
            console.log(`   Terminated: ${proc}`);
            killedCount++;
          } else {
            console.warn(`   WARNING: Failed to terminate: ${proc}`);
          }
        } catch (err) {
          console.warn(`   WARNING: Error terminating ${proc}: ${err}`);
        }
      }
      
      if (killedCount > 0) {
        console.log(`   Terminated ${killedCount} process(es). Waiting 2 seconds for file handles to release...\n`);
        // Wait for file handles to be released
        sleepSync(2000);
      }
    } else {
      console.warn("\nWARNING: The following processes are running:");
      running.forEach(proc => console.warn(`   - ${proc}`));
      console.warn("\n   These processes may lock files and cause packaging to fail.");
      console.warn("   Please close ORC TORRENT and any Electron processes before running 'npm run dist'.");
      console.warn("\n   To automatically kill these processes, set AUTO_KILL_PROCESSES=1:");
      console.warn("   $env:AUTO_KILL_PROCESSES=1; npm run dist");
      console.warn("\n   Or manually kill them:");
      running.forEach(proc => {
        console.warn(`   taskkill /F /IM "${proc}"`);
      });
      console.warn("\n   Or use Task Manager (Ctrl+Shift+Esc) to end the processes.\n");
    }
  }
}

/**
 * Synchronous delay helper for Windows file handle release.
 */
function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy wait
  }
}

/**
 * Information about a process locking files.
 */
type LockingProcess = {
  name: string;
  pid: number;
  path?: string;
};

/**
 * Find which process is locking files using PowerShell.
 * Uses Get-CimInstance to check for processes that might have the directory open.
 * Returns null if no locking process is found.
 */
function findProcessLockingFilePowerShell(dirPath: string): LockingProcess | null {
  if (!isWin) return null;

  try {
    // Use PowerShell to check for common processes that might lock files
    // We check processes that commonly lock files: Explorer, Electron, antivirus
    const escapedPath = dirPath.replace(/\\/g, "\\\\").replace(/'/g, "''");
    const psScript = `
      $dir = '${escapedPath}'
      $suspiciousProcesses = @('explorer', 'electron', 'Code', 'devenv', 'MsMpEng', 'AvastSvc')
      $found = $null
      
      foreach ($procName in $suspiciousProcesses) {
        $procs = Get-Process -Name $procName -ErrorAction SilentlyContinue
        foreach ($proc in $procs) {
          try {
            # Check if process has modules loaded from the directory
            $modules = $proc.Modules | Where-Object { 
              $_.FileName -ne $null -and $_.FileName -like "*$dir*" 
            }
            if ($modules) {
              $found = [PSCustomObject]@{
                Name = "$procName.exe"
                Id = $proc.Id
                Path = $modules[0].FileName
              }
              break
            }
          } catch {
            # Ignore access denied errors
          }
        }
        if ($found) { break }
      }
      
      if ($found) {
        Write-Output "$($found.Name)|$($found.Id)|$($found.Path)"
      }
    `;

    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      psScript
    ], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
      timeout: 10000,
    });

    if (result.status === 0 && result.stdout) {
      const output = result.stdout.toString().trim();
      if (output) {
        // Parse output: "Name.exe|PID|Path"
        const parts = output.split("|");
        if (parts.length >= 2) {
          const name = parts[0];
          const pid = parseInt(parts[1], 10) || 0;
          const path = parts[2] || undefined;
          return { name, pid, path };
        }
      }
    }
  } catch {
    // PowerShell detection failed, continue to other strategies
  }

  return null;
}

/**
 * Try to use Sysinternals handle.exe if available to find locking processes.
 * Returns null if handle.exe is not available or no locks found.
 */
function findProcessLockingFileHandleExe(dirPath: string): LockingProcess | null {
  if (!isWin) return null;

  try {
    // Check if handle.exe is in PATH
    const handleCheck = spawnSync("handle.exe", ["/?"], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
    });

    if (handleCheck.status !== 0 && handleCheck.error) {
      // handle.exe not found
      return null;
    }

    // Use handle.exe to find processes locking files in the directory
    const result = spawnSync("handle.exe", [dirPath], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
      timeout: 10000,
    });

    if (result.status === 0 && result.stdout) {
      const output = result.stdout.toString();
      // Parse handle.exe output format: "process.exe pid: 1234"
      const lines = output.split("\n");
      for (const line of lines) {
        const match = line.match(/(\S+\.exe)\s+pid:\s+(\d+)/i);
        if (match) {
          const name = match[1];
          const pid = parseInt(match[2], 10);
          return { name, pid };
        }
      }
    }
  } catch {
    // handle.exe not available or failed
  }

  return null;
}

/**
 * Find which process is locking files in the given directory.
 * Uses multiple strategies: PowerShell, handle.exe, openfiles, or checks common processes.
 * Returns null if no locking process is found.
 */
function findProcessLockingFile(dirPath: string): LockingProcess | null {
  if (!isWin) return null;

  const psResult = findProcessLockingFilePowerShell(dirPath);
  if (psResult) return psResult;

  const handleResult = findProcessLockingFileHandleExe(dirPath);
  if (handleResult) return handleResult;

  try {
    const result = spawnSync("openfiles", ["/query", "/fo", "csv", "/v"], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
    });

    if (result.status === 0 && result.stdout) {
      const output = result.stdout.toString();
      const lines = output.split("\n");
      
      // CSV format: "Hostname","ID","Accessed By","Type","Open File (Path/executable)"
      for (const line of lines) {
        if (!line.trim() || line.includes("HOSTNAME") || !line.includes(dirPath)) {
          continue;
        }

        // Parse CSV line (simple parsing - assumes no commas in paths)
        const matches = line.match(/"([^"]+)"/g);
        if (matches && matches.length >= 5) {
          const accessedBy = matches[2]?.replace(/"/g, "") || "";
          const openFile = matches[4]?.replace(/"/g, "") || "";
          
          if (openFile.toLowerCase().includes(dirPath.toLowerCase())) {
            // Extract process name and PID from "Accessed By" field
            // Format is usually "PROCESS_NAME (PID)"
            const pidMatch = accessedBy.match(/\((\d+)\)/);
            const processName = accessedBy.split("(")[0]?.trim() || accessedBy;
            
            if (pidMatch) {
              const pid = parseInt(pidMatch[1], 10);
              return { name: processName, pid, path: openFile };
            }
          }
        }
      }
    }
  } catch {
    // openfiles may not be available or require admin - continue to other strategies
  }

  const commonLockingProcesses = ["MsMpEng.exe", "MsMpEngCP.exe", "AvastSvc.exe", "avgnt.exe"];
  
  for (const procName of commonLockingProcesses) {
    try {
      // Get PID of the process using wmic
      const result = spawnSync("wmic", [
        "process",
        "where",
        `name="${procName}"`,
        "get",
        "processid",
        "/format:csv"
      ], {
        encoding: "utf8",
        shell: false,
        stdio: "pipe",
      });

      if (result.status === 0 && result.stdout) {
        const output = result.stdout.toString();
        const pidMatch = output.match(/Node,\s*(\d+)/);
        
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          // These antivirus processes are likely locking files if they're running
          return { name: procName, pid };
        }
      }
    } catch {
      // Continue to next process
    }
  }

  return null;
}

/**
 * Kill a process by PID using taskkill.
 * Returns true if successful, false otherwise.
 */
function killProcessByPid(pid: number): boolean {
  if (!isWin || pid <= 0) return false;

  try {
    const result = spawnSync("taskkill", ["/F", "/PID", pid.toString()], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
    });

    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Kill a process by name using taskkill.
 * Returns number of processes killed.
 */
function killProcessByName(processName: string): number {
  if (!isWin) return 0;

  try {
    const result = spawnSync("taskkill", ["/F", "/IM", processName], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
    });

    if (result.status === 0) {
      // Parse output to count killed processes
      const output = result.stdout?.toString() || "";
      const match = output.match(/(\d+)\s+process\(es\)/);
      return match ? parseInt(match[1], 10) : 1;
    }
    return 0;
  } catch {
    return 0;
  }
}

function tryWindowsRmdir(dirPath: string): boolean {
  if (!isWin) return false;
  
  try {
    // Use cmd.exe rmdir /s /q which can handle some locked files
    const result = spawnSync("cmd.exe", ["/c", "rmdir", "/s", "/q", dirPath], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
    });
    
    return result.status === 0 && !existsSync(dirPath);
  } catch {
    return false;
  }
}

/**
 * Try to delete directory using PowerShell Remove-Item.
 * PowerShell has different file locking behavior than cmd.exe.
 */
function tryPowerShellRemove(dirPath: string): boolean {
  if (!isWin) return false;
  
  try {
    // Escape the path for PowerShell (replace backslashes and wrap in quotes)
    const escapedPath = dirPath.replace(/\\/g, "\\\\").replace(/'/g, "''");
    const psCommand = `Remove-Item -LiteralPath '${escapedPath}' -Recurse -Force -ErrorAction Stop`;
    
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      psCommand
    ], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
    });
    
    return result.status === 0 && !existsSync(dirPath);
  } catch {
    return false;
  }
}

/**
 * Try to change ownership and permissions before deleting.
 * Uses takeown and icacls to gain full control of locked files.
 * May require administrator privileges.
 */
function tryTakeOwnershipAndDelete(dirPath: string): boolean {
  if (!isWin) return false;
  
  try {
    // First, try to take ownership using takeown
    const takeownResult = spawnSync("takeown", ["/f", dirPath, "/r", "/d", "y"], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
    });
    
    const currentUser = process.env.USERNAME || process.env.USER || "Administrators";
    const icaclsResult1 = spawnSync("icacls", [dirPath, "/grant", `${currentUser}:F`, "/T", "/q"], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
    });
    
    const icaclsResult2 = spawnSync("icacls", [dirPath, "/grant", "Administrators:F", "/T", "/q"], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
    });
    
    // Wait a moment for permissions to take effect
    sleepSync(1000);
    
    // Try multiple deletion methods after taking ownership
    if (tryWindowsRmdir(dirPath)) return true;
    if (tryPowerShellRemove(dirPath)) return true;
    
    // Last resort: try Node's rmSync
    try {
      rmSync(dirPath, { recursive: true, force: true });
      return !existsSync(dirPath);
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

function tryRobocopyMirrorDelete(dirPath: string): boolean {
  if (!isWin) return false;
  
  try {
    // Create an empty temp directory
    const tempEmptyDir = mkdtempSync(join(tmpdir(), `empty_${Date.now()}_`));
    
    // Use robocopy to mirror the empty dir (which deletes all files)
    // /MIR mirrors, /NFL no file list, /NDL no directory list, /NJH no job header, /NJS no job summary
    const robocopyResult = spawnSync("robocopy", [
      tempEmptyDir,
      dirPath,
      "/MIR",
      "/NFL",
      "/NDL",
      "/NJH",
      "/NJS",
      "/NP",
      "/R:0",  // Retry 0 times
      "/W:0"   // Wait 0 seconds between retries
    ], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
    });
    
    // Clean up temp directory
    try {
      rmSync(tempEmptyDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    
    // Robocopy returns 0-7 for success, 8+ for errors
    // After mirroring, try to remove the now-empty directory
    if (robocopyResult.status !== undefined && robocopyResult.status <= 7) {
      sleepSync(500);
      return tryWindowsRmdir(dirPath);
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Try rename-then-delete strategy for stubborn locked directories.
 * Renaming can sometimes work even when deletion fails.
 */
function tryRenameThenDelete(dirPath: string): boolean {
  if (!isWin) return false;
  
  try {
    // Generate a temporary name in the same parent directory
    const parentDir = dirname(dirPath);
    const tempName = join(parentDir, `_temp_delete_${Date.now()}_${Math.random().toString(36).substring(7)}`);
    
    // Try to rename the directory
    renameSync(dirPath, tempName);
    
    // If rename succeeded, try to delete the renamed directory
    // Give it a moment for handles to release
    sleepSync(1000);
    
    // Try multiple methods on the renamed directory
    if (tryTakeOwnershipAndDelete(tempName)) return true;
    if (tryWindowsRmdir(tempName)) return true;
    if (tryPowerShellRemove(tempName)) return true;
    if (tryRobocopyMirrorDelete(tempName)) return true;
    
    // Last resort: try Node's rmSync on the renamed directory
    try {
      rmSync(tempName, { recursive: true, force: true });
      return !existsSync(tempName);
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

function scheduleDeletionOnReboot(dirPath: string): boolean {
  if (!isWin) return false;

  try {
    // Use PowerShell to call MoveFileEx with MOVEFILE_DELAY_UNTIL_REBOOT flag
    const escapedPath = dirPath.replace(/\\/g, "\\\\").replace(/'/g, "''");
    const psScript = `
      Add-Type -TypeDefinition @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Auto)]
          public static extern bool MoveFileEx(string lpExistingFileName, string lpNewFileName, int dwFlags);
        }
"@
      $MOVEFILE_DELAY_UNTIL_REBOOT = 4
      $result = [Win32]::MoveFileEx("${escapedPath}", $null, $MOVEFILE_DELAY_UNTIL_REBOOT)
      if ($result) {
        Write-Output "SCHEDULED"
      } else {
        Write-Output "FAILED"
      }
    `;

    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      psScript
    ], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
      timeout: 10000,
    });

    if (result.status === 0 && result.stdout) {
      const output = result.stdout.toString().trim();
      return output.includes("SCHEDULED");
    }
  } catch {
    // Failed to schedule deletion
  }

  return false;
}

/**
 * Copy directory recursively (for moving build output).
 */
function copyDirectoryRecursive(src: string, dest: string): void {
  if (!existsSync(src)) {
    throw new Error(`Source directory does not exist: ${src}`);
  }

  // Create destination directory
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Move directory by copying then deleting source.
 * Used when direct move fails due to file locks.
 */
function moveDirectorySafe(src: string, dest: string): boolean {
  try {
    // Try direct rename first (fastest)
    try {
      renameSync(src, dest);
      return true;
    } catch {
      // Rename failed, try copy + delete
    }

    // Copy directory
    copyDirectoryRecursive(src, dest);

    // Try to delete source (with retries)
    for (let i = 0; i < 3; i++) {
      try {
        rmSync(src, { recursive: true, force: true });
        if (!existsSync(src)) {
          return true;
        }
      } catch {
        if (i < 2) {
          sleepSync(1000);
        }
      }
    }

    // If source still exists, at least the copy succeeded
    // The old directory will be cleaned up later or on reboot
    return existsSync(dest);
  } catch {
    return false;
  }
}

/**
 * Determine if we should use the temp directory workaround.
 */
function shouldUseTempOutputWorkaround(winUnpackedDir: string): boolean {
  if (!isWin) return false;

  // Force workaround via environment variable
  const forceWorkaround = process.env.USE_TEMP_OUTPUT_ON_LOCK === "1" || 
                          process.env.USE_TEMP_OUTPUT_ON_LOCK === "true";
  
  if (forceWorkaround) {
    return true;
  }

  // Auto-enable if directory exists and is likely locked
  if (existsSync(winUnpackedDir)) {
    // Try a simple test to see if we can delete a file in the directory
    try {
      const testFile = join(winUnpackedDir, ".test-delete");
      writeFileSync(testFile, "test");
      rmSync(testFile);
      return false; // Directory is not locked
    } catch {
      return true; // Directory appears to be locked
    }
  }

  return false;
}

/**
 * Get or create temporary output directory for electron-builder.
 * Returns the temp directory path, or null if workaround not needed.
 */
function getTempOutputDirectory(winUnpackedDir: string): string | null {
  if (!shouldUseTempOutputWorkaround(winUnpackedDir)) {
    return null;
  }

  // Create temporary output directory
  const tempOutputDir = mkdtempSync(join(tmpdir(), "orc-builder-output-"));
  
  console.log("\n🔄 Using temporary output directory workaround...");
  console.log(`   Temp directory: ${tempOutputDir}`);
  console.log("   (This bypasses locked files in the normal output directory)");

  return tempOutputDir;
}

/**
 * Move build output from temp directory to final location after successful build.
 */
function moveTempOutputToFinal(tempOutputDir: string, finalWinUnpackedDir: string): boolean {
  if (!isWin) return false;

  const tempWinUnpacked = join(tempOutputDir, "win-unpacked");
  
  if (!existsSync(tempWinUnpacked)) {
    console.warn("\nWARNING: Temp build output not found, cannot move to final location.");
    return false;
  }

  console.log("\nMoving build output from temp directory to final location...");
  console.log(`   From: ${tempWinUnpacked}`);
  console.log(`   To: ${finalWinUnpackedDir}`);

  // Ensure parent directory exists
  const finalParent = dirname(finalWinUnpackedDir);
  if (!existsSync(finalParent)) {
    mkdirSync(finalParent, { recursive: true });
  }

  // Try to move the directory
  if (moveDirectorySafe(tempWinUnpacked, finalWinUnpackedDir)) {
    console.log("   Successfully moved build output");
    
    // Clean up temp directory
    try {
      rmSync(tempOutputDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors for temp directory
    }
    
    return true;
  } else {
    console.warn("   WARNING: Failed to move build output. It remains in:");
    console.warn(`      ${tempWinUnpacked}`);
    console.warn("   You may need to manually move it or delete the locked directory first.");
    return false;
  }
}

/**
 * Automatically attempt to resolve file locks by killing safe processes.
 * Returns true if a process was killed, false otherwise.
 */
function autoResolveFileLocks(winUnpackedDir: string): boolean {
  if (!isWin) return false;

  const lockingProcess = findProcessLockingFile(winUnpackedDir);
  if (!lockingProcess) return false;

  const isExplorer = lockingProcess.name.toLowerCase() === "explorer.exe";
  
  // Never kill explorer.exe - it would close the desktop
  if (isExplorer) {
    console.log("\nDetected: Windows Explorer may have the directory open.");
    console.log("   (Cannot auto-kill explorer.exe - it would close your desktop)");
    console.log("   Tip: Close any Explorer windows viewing the dist directory.");
    return false;
  }

  // Safe processes to auto-kill: app/daemon and common editors that may lock app.asar
  const safeToKill = [
    "electron.exe",
    "ORC TORRENT.exe",
    "orc-daemon.exe",
    "Code.exe",
  ];

  const canAutoKill = safeToKill.some(safe => 
    lockingProcess.name.toLowerCase().includes(safe.toLowerCase())
  );

  if (!canAutoKill) {
    // Unknown process - be cautious but still try if it's not a system process
    const systemProcesses = ["svchost.exe", "dwm.exe", "winlogon.exe", "csrss.exe", "lsass.exe"];
    const isSystemProcess = systemProcesses.some(sys => 
      lockingProcess.name.toLowerCase().includes(sys)
    );
    
    if (isSystemProcess) {
      console.log(`\nDetected system process locking files: ${lockingProcess.name}`);
      console.log("   (Skipping auto-kill for safety)");
      return false;
    }
  }

  // Auto-kill the process
  console.log(`\nAuto-detected process locking files: ${lockingProcess.name}`);
  if (lockingProcess.pid > 0) {
    console.log(`   PID: ${lockingProcess.pid}`);
  }
  console.log("🔪 Auto-terminating locking process...");

  let killed = false;
  if (lockingProcess.pid > 0) {
    killed = killProcessByPid(lockingProcess.pid);
  }

  // If PID-based kill failed or PID is unknown, try name-based kill
  if (!killed && lockingProcess.name) {
    const killedCount = killProcessByName(lockingProcess.name);
    killed = killedCount > 0;
  }

  if (killed) {
    console.log(`   Terminated: ${lockingProcess.name}`);
    console.log("   Waiting 3 seconds for file handles to release...");
    sleepSync(3000);
    return true;
  } else {
    console.warn(`   WARNING: Failed to terminate: ${lockingProcess.name}`);
    return false;
  }
}

/**
 * Clean the dist/win-unpacked directory with retry logic for locked files.
 * Uses multiple Windows-specific deletion strategies to handle file locks.
 * Automatically detects and resolves file locks when possible.
 */
function cleanDistDirectory(): boolean {
  const distDir = join(projectRoot, "dist");
  const winUnpackedDir = join(distDir, "win-unpacked");

  if (!existsSync(winUnpackedDir)) {
    console.log("\nNo dist/win-unpacked directory to clean (good!)");
    return true; // Nothing to clean, success
  }

  console.log("\nCleaning dist/win-unpacked directory...");
  console.log(`   Path: ${winUnpackedDir}`);

  // Automatically attempt to resolve file locks
  if (isWin) {
    const resolved = autoResolveFileLocks(winUnpackedDir);
    if (resolved) {
      console.log("   File locks resolved, proceeding with cleanup...");
    }
  }

  const maxRetries = 5;
  const retryDelayMs = 2000; // Increased to 2 seconds for Windows
  const initialDelayMs = 2000; // Increased initial delay to 2 seconds

  // Longer initial delay to allow Windows to release any lingering file handles
  // This is especially important for antivirus/file indexers
  sleepSync(initialDelayMs);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`   ⏳ Retry ${attempt}/${maxRetries - 1} after ${retryDelayMs}ms delay...`);
      sleepSync(retryDelayMs);
    }

    try {
      rmSync(winUnpackedDir, { recursive: true, force: true });
      if (!existsSync(winUnpackedDir)) {
        console.log("   Directory cleaned successfully (Node.js rmSync)");
        return true; // Success
      }
    } catch (err: any) {
      // Continue to try other methods
    }

    if (tryWindowsRmdir(winUnpackedDir)) {
      console.log("   Directory cleaned successfully (Windows rmdir)");
      return true; // Success
    }

    if (tryPowerShellRemove(winUnpackedDir)) {
      console.log("   Directory cleaned successfully (PowerShell)");
      return true; // Success
    }

    if (attempt >= 2) {
      if (tryTakeOwnershipAndDelete(winUnpackedDir)) {
        console.log("   Directory cleaned successfully (takeown/icacls)");
        return true; // Success
      }
    }

    if (attempt >= 3) {
      if (tryRobocopyMirrorDelete(winUnpackedDir)) {
        console.log("   Directory cleaned successfully (robocopy)");
        return true; // Success
      }
    }

    if (attempt === maxRetries - 1) {
      console.log("   🔄 Trying rename-then-delete strategy...");
      if (tryRenameThenDelete(winUnpackedDir)) {
        console.log("   Directory cleaned successfully (rename-then-delete)");
        return true; // Success
      }
    }

    // Check if directory still exists before next retry
    if (!existsSync(winUnpackedDir)) {
      console.log("   Directory cleaned successfully");
      return true; // Success
    }
  }

  // All strategies failed
  const stillExists = existsSync(winUnpackedDir);
  if (stillExists) {
    console.warn("\nWARNING: Failed to clean dist/win-unpacked directory after all retries.");
    
    // Try one more time to resolve locks
    if (isWin) {
      console.log("   🔄 Attempting final auto-resolution of file locks...");
      const resolved = autoResolveFileLocks(winUnpackedDir);
      if (resolved) {
        // Try cleanup one more time after killing process
        sleepSync(2000);
        try {
          rmSync(winUnpackedDir, { recursive: true, force: true });
          if (!existsSync(winUnpackedDir)) {
            console.log("   Directory cleaned after resolving file locks!");
            return true;
          }
        } catch {
          // Still locked, continue to workaround
        }
      }
    }
    
    // Re-check for locking process
    let currentLockingProcess: LockingProcess | null = null;
    if (isWin) {
      currentLockingProcess = findProcessLockingFile(winUnpackedDir);
      if (currentLockingProcess) {
        console.warn(`\n   Files are still locked by: ${currentLockingProcess.name}`);
        if (currentLockingProcess.pid > 0) {
          console.warn(`   Process ID: ${currentLockingProcess.pid}`);
        }
      } else {
        console.warn("   Files appear to be locked by another process (antivirus, Windows Explorer, or system process).");
      }
    }
    
    // Automatically enable temp output workaround
    console.warn("\n   🔄 Auto-enabling temp output workaround to bypass locked files...");
    return false; // Indicate cleanup failed, workaround will be used
  }
  
  return true; // Successfully cleaned
}

console.log("\nOrc Torrent — Packaging (electron-builder)\n");

process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

printToolVersions();

if (isWin && !hasSymlinkPrivilege()) {
  if (process.env.ORC_SKIP_SYMLINK_CHECK === "1") {
    console.warn("WARNING: Symlink privilege not available (ORC_SKIP_SYMLINK_CHECK=1). Continuing anyway; build may fail.\n");
  } else {
    console.error("ERROR: Windows symlink privilege is not available.");
    console.error("   electron-builder will fail extracting winCodeSign without symlink rights.\n");
    console.error("   Fix options:");
    console.error("   1) Enable Developer Mode: Settings -> Privacy & security -> For developers -> Developer Mode");
    console.error("   2) Or run your terminal as Administrator");
    console.error("   3) Or set ORC_SKIP_SYMLINK_CHECK=1 to attempt anyway (may fail)\n");
    process.exit(2);
  }
}

// Keep the cache clean so you don't repeatedly hit broken partial extracts
clearWinCodeSignCache();

// Check for running processes that might lock files
checkRunningProcesses();

cleanDistDirectory();

console.log("\nRunning build pipeline...\n");
run("npm", ["run", "build"], projectRoot);

console.log("\nFinal cleanup before packaging...\n");
const winUnpackedDir = join(projectRoot, "dist", "win-unpacked");

let tempOutputDir: string | null = null;
let needsWorkaround = false;

if (isWin && existsSync(winUnpackedDir)) {
  // Auto-detect if cleanup is needed and try to resolve
  console.log("   Checking for file locks...");
  
  // Try automatic lock resolution first
  const resolved = autoResolveFileLocks(winUnpackedDir);
  if (resolved) {
    sleepSync(2000); // Wait for handles to release
  }
  
  // Check if files are locked by trying to delete a test file
  let hasLocks = false;
  try {
    const testFile = join(winUnpackedDir, ".test-delete-check");
    writeFileSync(testFile, "test");
    rmSync(testFile);
  } catch {
    // Can't write/delete - directory is likely locked
    hasLocks = true;
    console.log("   WARNING: Detected file locks in directory");
  }
  
  // Try aggressive cleanup
  let cleaned = false;
  
  // Method 1: Try direct deletion first
  try {
    rmSync(winUnpackedDir, { recursive: true, force: true });
    if (!existsSync(winUnpackedDir)) {
      console.log("   Cleaned successfully");
      cleaned = true;
    }
  } catch (err: any) {
    // Check if it's a locking error
    const errMsg = err?.message?.toLowerCase() || "";
    if (errMsg.includes("being used") || errMsg.includes("cannot access") || errMsg.includes("locked")) {
      hasLocks = true;
    }
  }
  
  // Method 2: Try rename-then-delete
  if (!cleaned && existsSync(winUnpackedDir)) {
    try {
      const tempName = `${winUnpackedDir}_delete_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      renameSync(winUnpackedDir, tempName);
      sleepSync(1000);
      rmSync(tempName, { recursive: true, force: true });
      if (!existsSync(tempName)) {
        console.log("   Cleaned using rename-then-delete");
        cleaned = true;
      }
    } catch (err: any) {
      const errMsg = err?.message?.toLowerCase() || "";
      if (errMsg.includes("being used") || errMsg.includes("cannot access") || errMsg.includes("locked")) {
        hasLocks = true;
      }
    }
  }
  
  // Method 3: Try Windows native commands
  if (!cleaned && existsSync(winUnpackedDir)) {
    if (tryWindowsRmdir(winUnpackedDir)) {
      console.log("   Cleaned using Windows rmdir");
      cleaned = true;
    } else if (tryPowerShellRemove(winUnpackedDir)) {
      console.log("   Cleaned using PowerShell");
      cleaned = true;
    }
  }
  
  // If still not cleaned OR we detected locks, enable workaround proactively
  if ((!cleaned && existsSync(winUnpackedDir)) || hasLocks) {
    needsWorkaround = true;
    tempOutputDir = getTempOutputDirectory(winUnpackedDir);
    if (tempOutputDir) {
      console.log("   🔄 Auto-enabling temp output workaround to bypass locked files...");
    }
  }
} else if (isWin) {
  // Directory doesn't exist, but check if we should use workaround anyway (proactive)
  // This helps if previous runs had issues
  const useProactiveWorkaround = process.env.USE_TEMP_OUTPUT_ON_LOCK === "1" || 
                                  process.env.USE_TEMP_OUTPUT_ON_LOCK === "true";
  if (useProactiveWorkaround) {
    tempOutputDir = getTempOutputDirectory(join(projectRoot, "dist", "win-unpacked"));
    if (tempOutputDir) {
      needsWorkaround = true;
      console.log("   🔄 Using temp output workaround (proactive mode)...");
    }
  }
}

// Give Windows a moment to release any lingering file handles
if (isWin && !needsWorkaround) {
  console.log("   Waiting 2 seconds for file handles to release...");
  sleepSync(2000);
}

// Run electron-builder (local binary, deterministic)
const eb = localBin("electron-builder");
if (!existsSync(eb)) {
  console.error("\nERROR: electron-builder not found in node_modules.");
  console.error("   Run: npm ci (for CI) or npm install (for dev)");
  process.exit(1);
}

// If workaround was auto-enabled, use temp output
// (tempOutputDir is already set if needed from final cleanup above)

// PACK_DIR_ONLY=1 or dist:quick: only produce unpacked dir (no NSIS, no zip) — much faster
const packDirOnly = process.env.PACK_DIR_ONLY === "1" || process.env.PACK_DIR_ONLY === "true";
const electronBuilderArgs = packDirOnly ? ["--dir", "--publish", "never"] : ["--publish", "never"];
let buildSucceeded = false;

if (tempOutputDir) {
  electronBuilderArgs.push("--config.directories.output", tempOutputDir);
  console.log("   Building to temp directory, will move to final location after build.\n");
}

if (isWin) {
  const assetsIcon = join(projectRoot, "assets", "icons", "icon.ico");
  const repoRoot = resolve(projectRoot, "..", "..");
  const orcTorrentIco = join(repoRoot, "icons", "orc-torrent.ico");
  if (existsSync(orcTorrentIco)) {
    copyFileSync(orcTorrentIco, assetsIcon);
    console.log("   Using orc-torrent.ico as app icon.");
  }
  const resizeScript = join(projectRoot, "scripts", "resize-icon.ps1");
  const createScript = join(projectRoot, "scripts", "create-icon.ps1");
  const sourceIco = join(projectRoot, "assets", "icons", "orc_ico(1).ico");
  let iconOk = existsSync(assetsIcon);

  // Generate icon if missing
  if (!iconOk && existsSync(sourceIco) && existsSync(resizeScript)) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resizeScript], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
      cwd: projectRoot,
    });
    if (r.status === 0) {
      iconOk = true;
      console.log("   Regenerated icon.ico from orc_ico(1).ico (256x256)");
    }
  }
  if (!iconOk && existsSync(createScript)) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", createScript], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
      cwd: projectRoot,
    });
    if (r.status === 0) {
      iconOk = true;
      console.log("   Regenerated icon.ico (256x256)");
    }
  }

  // Always resize to 256x256 — electron-builder requires at least 256x256
  if (iconOk && existsSync(resizeScript) && existsSync(assetsIcon)) {
    const r = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", resizeScript,
      "-Source", assetsIcon,
    ], {
      encoding: "utf8",
      shell: false,
      stdio: "pipe",
      cwd: projectRoot,
    });
    if (r.status === 0) {
      console.log("   Ensured icon.ico is 256x256 for electron-builder.");
    } else if (r.stderr) {
      console.warn("   Warning: Could not resize icon:", r.stderr.toString().trim());
    }
  }
  console.log("");

  if (!iconOk && !existsSync(assetsIcon)) {
    console.warn("   WARNING: assets/icons/icon.ico not found and could not be generated. Installer may fail.\n");
  }
}

if (packDirOnly) {
  console.log("Creating unpacked app only (PACK_DIR_ONLY=1 — no installer/zip)...\n");
} else {
  console.log("\nCreating installer with electron-builder...\n");
}

if (!tempOutputDir && isWin && existsSync(winUnpackedDir)) {
  // Double-check: try to detect if files are actually locked
  let definitelyLocked = false;
  try {
    // Try to create and delete a test file to check for locks
    const testPath = join(winUnpackedDir, "resources", "app.asar");
    const testDir = dirname(testPath);
    if (existsSync(testDir)) {
      // Directory exists, check if we can write to it
      const testFile = join(testDir, ".lock-test");
      try {
        writeFileSync(testFile, "test");
        rmSync(testFile);
      } catch {
        definitelyLocked = true;
      }
    }
  } catch {
    // If we can't even check, assume it might be locked
  }
  
  if (definitelyLocked) {
    console.log("   WARNING: Detected locked files. Enabling temp output workaround...");
    tempOutputDir = getTempOutputDirectory(winUnpackedDir);
    if (tempOutputDir) {
      electronBuilderArgs.length = 2; // Reset args
      electronBuilderArgs.push("--publish", "never", "--config.directories.output", tempOutputDir);
      console.log("   Will build to temp directory to bypass locks.\n");
    }
  }
}

run(eb, electronBuilderArgs, projectRoot);
buildSucceeded = true;

if (!buildSucceeded) {
  console.error("\nERROR: electron-builder failed.");
  process.exit(1);
}

// If we used temp output, move it to the final location
if (tempOutputDir && isWin && buildSucceeded) {
  const finalWinUnpacked = join(projectRoot, "dist", "win-unpacked");
  const moved = moveTempOutputToFinal(tempOutputDir, finalWinUnpacked);
  
  if (!moved) {
    console.warn("\nWARNING: Build completed but output is in temp directory:");
    console.warn(`   ${join(tempOutputDir, "win-unpacked")}`);
    console.warn("   You may need to manually move it or delete the locked directory first.\n");
  }
}

console.log("\nPackaging complete.\n");
