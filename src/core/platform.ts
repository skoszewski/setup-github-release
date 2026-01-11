import * as os from 'os';

export interface PlatformInfo {
  system: string;
  arch: string;
  systemPattern: string;
  archPattern: string;
}

export const systemPatterns: Record<string, string> = {
  linux: 'linux',
  darwin: '(darwin|macos|mac|osx)',
  win32: '(windows|win)'
};

export const archPatterns: Record<string, string> = {
  x64: '(x86_64|x64|amd64)',
  arm64: '(aarch64|arm64)'
};

export function getPlatformInfo(): PlatformInfo {
  const system = os.platform();
  const arch = os.arch();

  return {
    system,
    arch,
    systemPattern: systemPatterns[system] || system,
    archPattern: archPatterns[arch] || arch
  };
}
