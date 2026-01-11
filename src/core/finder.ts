import * as fs from 'fs';
import * as path from 'path';

export function findBinary(dir: string, pattern: string | RegExp, debug: boolean, logger: (msg: string) => void): string | undefined {
  const items = fs.readdirSync(dir);
  if (debug) {
    logger(`Searching for binary in ${dir}...`);
    items.forEach(item => logger(` - ${item}`));
  }

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const found = findBinary(fullPath, pattern, debug, logger);
      if (found) return found;
    } else {
      let isMatch = false;
      if (pattern instanceof RegExp) {
        isMatch = pattern.test(item);
      } else {
        isMatch = item === pattern;
        // On Windows, also check for .exe extension if the pattern doesn't have it
        if (!isMatch && process.platform === 'win32' && !pattern.toLowerCase().endsWith('.exe')) {
          isMatch = item.toLowerCase() === `${pattern.toLowerCase()}.exe`;
        }
      }
      if (isMatch) return fullPath;
    }
  }
  return undefined;
}

export function setExecutable(filePath: string): void {
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, '755');
  }
}
