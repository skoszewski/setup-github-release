import { PlatformInfo } from './platform';

export interface MatchOptions {
  fileName?: string;
  fileType?: string;
}

export function getMatchingAsset(assets: any[], platform: PlatformInfo, options: MatchOptions): any {
  const { fileName, fileType = 'archive' } = options;
  let extPattern: string;
  if (fileType === 'archive') {
    extPattern = '\\.(zip|tar\\.gz|tar|tgz|7z)';
  } else if (fileType === 'package') {
    extPattern = '\\.(deb|rpm|pkg)';
  } else {
    extPattern = fileType;
  }

  if (!fileName) {
    // Rule 1: Default matching rule
    const pattern = `${platform.systemPattern}[_-]${platform.archPattern}.*${extPattern}$`;
    const regex = new RegExp(pattern, 'i');
    const matchingAssets = assets.filter((a: any) => regex.test(a.name));
    if (matchingAssets.length === 0) {
      throw new Error(`No assets matched the default criteria: ${pattern}`);
    }
    if (matchingAssets.length > 1) {
      throw new Error(`Multiple assets matched the default criteria: ${matchingAssets.map((a: any) => a.name).join(', ')}`);
    }
    return matchingAssets[0];
  } else if (fileName.startsWith('~')) {
    // Rule 3: Regex matching rule
    let pattern = fileName.substring(1);
    const hasSystem = pattern.includes('{{SYSTEM}}');
    const hasArch = pattern.includes('{{ARCH}}');
    const hasExt = pattern.includes('{{EXT_PATTERN}}');
    const hasEnd = pattern.endsWith('$');

    if (!hasSystem && !hasArch && !hasExt && !hasEnd) {
      pattern += `.*{{SYSTEM}}[_-]{{ARCH}}.*{{EXT_PATTERN}}$`;
    } else if (hasSystem && hasArch && !hasExt && !hasEnd) {
      pattern += `.*{{EXT_PATTERN}}$`;
    }

    const finalPattern = pattern
      .replace(/{{SYSTEM}}/g, platform.systemPattern)
      .replace(/{{ARCH}}/g, platform.archPattern)
      .replace(/{{EXT_PATTERN}}/g, extPattern);

    const regex = new RegExp(finalPattern, 'i');
    const matchingAssets = assets.filter((a: any) => regex.test(a.name));
    if (matchingAssets.length === 0) {
      throw new Error(`No assets matched the regex: ${finalPattern}`);
    }
    if (matchingAssets.length > 1) {
      throw new Error(`Multiple assets matched the criteria: ${matchingAssets.map((a: any) => a.name).join(', ')}`);
    }
    return matchingAssets[0];
  } else {
    // Rule 2: Literal matching rule
    const asset = assets.find((a: any) => a.name === fileName);
    if (!asset) {
      throw new Error(`No asset found matching the exact name: ${fileName}`);
    }
    return asset;
  }
}
