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
      const command = `Expand-Archive -Path "${filePath}" -DestinationPath "${destDir}" -Force`;
      const result = spawnSync('powershell', ['-Command', command]);
      if (result.status !== 0) {
        throw new Error(`powershell Expand-Archive failed with status ${result.status}: ${result.stderr.toString()}`);
      }
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
