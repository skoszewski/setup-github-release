import * as path from 'path';
import { spawnSync } from 'child_process';

export function installSystemPackage(downloadPath: string): void {
  const fileName = path.basename(downloadPath).toLowerCase();

  const command: { binary: string; args: string[] } | undefined = fileName.endsWith('.deb')
    ? { binary: 'dpkg', args: ['-i', downloadPath] }
    : fileName.endsWith('.pkg')
      ? { binary: 'installer', args: ['-pkg', downloadPath, '-target', '/'] }
      : fileName.endsWith('.rpm')
        ? { binary: 'rpm', args: ['-i', downloadPath] }
        : undefined;

  if (!command) {
    throw new Error(`Unsupported package type: ${fileName}`);
  }

  const isRoot = process.getuid && process.getuid() === 0;
  const commandToRun = isRoot ? command.binary : 'sudo';
  const argsToRun = isRoot ? command.args : [command.binary, ...command.args];

  const result = spawnSync(commandToRun, argsToRun, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Failed to install package using ${commandToRun} ${argsToRun.join(' ')}.`);
  }
}
