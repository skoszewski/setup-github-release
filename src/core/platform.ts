import * as os from 'os';

export interface PlatformInfo {
  system: string;
  arch: string;
  systemPattern: string;
  archPattern: string;
}

export interface PlatformOverrides {
  system?: string;
  arch?: string;
}

export const systemPatterns: Record<string, string> = {
  linux: 'linux',
  darwin: '(darwin|macos|mac|osx)',
  win32: '(windows|win)'
};

export const archPatterns: Record<string, string> = {
  x64: '(x86_64|x64|amd64|universal)',
  arm64: '(aarch64|arm64|universal)'
};

export function getPlatformInfo(overrides?: PlatformOverrides): PlatformInfo {
  const system = (overrides?.system || os.platform()).toLowerCase();
  const arch = (overrides?.arch || os.arch()).toLowerCase();

  return {
    system,
    arch,
    systemPattern: systemPatterns[system] || system,
    archPattern: archPatterns[arch] || arch
  };
}
