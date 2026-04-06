import { PlatformInfo } from './platform';

export interface MatchOptions {
  fileName?: string;
  fileType?: string;
}

function normalizeCustomExtensionPattern(fileType: string): string {
  let pattern = fileType;

  if (!pattern.endsWith('$')) {
    pattern += '$';
  }

  if (!pattern.startsWith('\\.')) {
    pattern = `\\.${pattern}`;
  }

  return pattern;
}

function getExtPattern(fileType: string | undefined, system: string): string {
  const normalizedType = (fileType || '').toLowerCase();

  if (!normalizedType) {
    if (system === 'linux') {
      return '\\.(deb|rpm|zip|tar\\.gz|tgz)$';
    }
    if (system === 'darwin' || system === 'macos' || system === 'mac' || system === 'osx') {
      return '\\.(pkg|zip|tar\\.gz|tgz)$';
    }
    return '\\.(zip|tar\\.gz|tgz)$';
  }

  if (normalizedType === 'archive') {
    return '\\.(zip|tar\\.gz|tgz)$';
  }

  if (normalizedType === 'package') {
    return '\\.(deb|pkg|rpm)$';
  }

  const shorthandTypePatterns: Record<string, string> = {
    zip: '\\.(zip)$',
    gzip: '\\.(tar\\.gz|tgz)$',
    gz: '\\.(tar\\.gz|tgz)$',
    tar: '\\.(tar)$',
    'tar.gz': '\\.(tar\\.gz)$',
    tgz: '\\.(tgz)$',
    deb: '\\.(deb)$',
    pkg: '\\.(pkg)$',
    rpm: '\\.(rpm)$'
  };

  if (shorthandTypePatterns[normalizedType]) {
    return shorthandTypePatterns[normalizedType];
  }

  return normalizeCustomExtensionPattern(fileType || '');
}

function matchFilenameString(re: string, pi: PlatformInfo, extRe: string): string {
  const hasSystem = re.includes('{{SYSTEM}}');
  const hasArch = re.includes('{{ARCH}}');
  const hasExt = re.includes('{{EXT_PATTERN}}');
  const hasEnd = re.endsWith('$');

  const finalRe = (!hasSystem && !hasArch && !hasExt && !hasEnd)
    ? `${re}.*{{SYSTEM}}[_-]{{ARCH}}.*{{EXT_PATTERN}}$`
    : (hasSystem && hasArch && !hasExt && !hasEnd)
      ? `${re}.*{{EXT_PATTERN}}$`
      : re;

  return finalRe
    .replace(/{{SYSTEM}}/g, pi.systemPattern)
    .replace(/{{ARCH}}/g, pi.archPattern)
    .replace(/{{EXT_PATTERN}}/g, extRe);
}

function matchSingleAssetByRegex(assets: any[], pattern: string, noMatchError: string, multipleMatchErrorPrefix: string): any {
  const regex = new RegExp(pattern, 'i');
  const matchingAssets = assets.filter((a: any) => regex.test(a.name));
  if (matchingAssets.length === 0) {
    throw new Error(noMatchError);
  }
  if (matchingAssets.length > 1) {
    throw new Error(`${multipleMatchErrorPrefix}: ${matchingAssets.map((a: any) => a.name).join(', ')}`);
  }
  return matchingAssets[0];
}

export function getMatchingAsset(assets: any[], platform: PlatformInfo, options: MatchOptions): any {
  const { fileName, fileType } = options;
  const extPattern = getExtPattern(fileType, platform.system);

  if (!fileName || fileName.startsWith('~')) {
    // Rule 1 + Rule 3: Regex-based matching rules
    const pattern = !fileName
      ? `${platform.systemPattern}[_-]${platform.archPattern}.*${extPattern}`
      : matchFilenameString(fileName.substring(1), platform, extPattern);
    const noMatchError = !fileName
      ? `No assets matched the default criteria: ${pattern}`
      : `No assets matched the regex: ${pattern}`;
    const multipleMatchErrorPrefix = !fileName
      ? 'Multiple assets matched the default criteria'
      : 'Multiple assets matched the criteria';

    return matchSingleAssetByRegex(
      assets,
      pattern,
      noMatchError,
      multipleMatchErrorPrefix
    );
  } else {
    // Rule 2: Literal matching rule
    const asset = assets.find((a: any) => a.name === fileName);
    if (!asset) {
      throw new Error(`No asset found matching the exact name: ${fileName}`);
    }
    return asset;
  }
}
