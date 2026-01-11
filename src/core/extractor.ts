import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export async function extractAsset(filePath: string, destDir: string): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath).toLowerCase();

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (name.endsWith('.tar.gz') || name.endsWith('.tgz') || name.endsWith('.tar')) {
    const args = ['-xf', filePath, '-C', destDir];
    const result = spawnSync('tar', args);
    if (result.status !== 0) {
      throw new Error(`tar failed with status ${result.status}: ${result.stderr.toString()}`);
    }
  } else if (name.endsWith('.zip')) {
    if (process.platform === 'win32') {
      // Modern Windows 10/11 has tar that handles zip
      const tarResult = spawnSync('tar', ['-xf', filePath, '-C', destDir]);
      if (tarResult.status === 0) return;

      // Fallback: Use .NET ZipFile class to bypass PowerShell module trust issues (Microsoft.PowerShell.Archive)
      // We escape single quotes for PowerShell.
      const escapedFilePath = filePath.replace(/'/g, "''");
      const escapedDestDir = destDir.replace(/'/g, "''");
      const dotNetCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedFilePath}', '${escapedDestDir}')`;

      // Try pwsh (PowerShell 7) then powershell (Windows PowerShell)
      for (const shell of ['pwsh', 'powershell']) {
        const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', dotNetCommand]);
        if (result.status === 0) return;
      }

      throw new Error(`Extraction failed: Both tar and PowerShell fallback failed. Make sure your system can extract ZIP files.`);
    } else {
      const result = spawnSync('unzip', ['-q', filePath, '-d', destDir]);
      if (result.status !== 0) {
        throw new Error(`unzip failed with status ${result.status}: ${result.stderr.toString()}`);
      }
    }
  } else if (name.endsWith('.7z')) {
      const result = spawnSync('7z', ['x', filePath, `-o${destDir}`, '-y']);
      if (result.status !== 0) {
        throw new Error(`7z failed with status ${result.status}. Make sure 7z is installed.`);
      }
  } else {
    // For other files, we just copy them to the destination directory
    const destPath = path.join(destDir, path.basename(filePath));
    fs.copyFileSync(filePath, destPath);
  }
}
