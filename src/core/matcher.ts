import { PlatformInfo } from './platform';
import { minimatch } from 'minimatch';

type ReleaseAsset = { name: string; browser_download_url: string };

const knownFileTypes: Record<string, string> = {
  archive: '*.{zip,tar.gz,tgz}',
  package: '*.{deb,pkg,rpm}',
  linux: '*.{deb,rpm}',
  macos: '*.pkg',
  targz: '*.{tgz,tar.gz}',
};

function filterByRegex(assets: ReleaseAsset[], pattern: string): ReleaseAsset[] {
  const regex = new RegExp(pattern, 'i');
  return assets.filter((asset) => regex.test(asset.name));
}

function replacePlatformPlaceholders(pattern: string, platform: PlatformInfo): string {
  return pattern
    .replace(/{{SYSTEM}}/g, platform.systemPattern)
    .replace(/{{ARCH}}/g, platform.archPattern);
}

export function getMatchingAsset(assets: ReleaseAsset[], platform: PlatformInfo, fileName?: string, fileType?: string): ReleaseAsset {
  // Filename provided as literal string (no ~): exact match.
  if (fileName && !fileName.startsWith('~')) {
    const exactMatches = assets.filter((asset) => asset.name === fileName);
    if (exactMatches.length !== 1) {
      throw new Error(`Expected exactly one asset to match the provided filename, matched: ${exactMatches.length}`);
    }
    return exactMatches[0];
  }

  // Filetype filtering stage (or passthrough when not provided).
  let fileTypeFilteredAssets: ReleaseAsset[] = assets;
  if (fileType) {
    if (Object.hasOwn(knownFileTypes, fileType)) {
      // 2. Known fileType key: use predefined glob.
      const fileTypeGlob = knownFileTypes[fileType];
      fileTypeFilteredAssets = assets.filter((asset) => minimatch(asset.name, fileTypeGlob, { nocase: true }));
    } else if (fileType.startsWith('~')) {
      // 3. Custom regex fileType: match regex at end of string.
      const fileTypeRegex = `${fileType.substring(1)}$`;
      fileTypeFilteredAssets = filterByRegex(assets, fileTypeRegex);
    } else {
      // 4. Custom extension fileType: treat as plain extension glob.
      const extension = fileType.replace(/^\./, '');
      const fileTypeGlob = `*.${extension}`;
      fileTypeFilteredAssets = assets.filter((asset) => minimatch(asset.name, fileTypeGlob, { nocase: true }));
    }
  }

  // 4. Filename provided with ~: platform placeholder expansion and regex filtering.
  if (fileName && fileName.startsWith('~')) {
    const fileNamePattern = replacePlatformPlaceholders(fileName.substring(1), platform);
    const fileNameFilteredAssets = filterByRegex(fileTypeFilteredAssets, fileNamePattern);
    if (fileNameFilteredAssets.length !== 1) {
      throw new Error(`Expected exactly one asset to match the filename regex, matched: ${fileNameFilteredAssets.length}`);
    }
    return fileNameFilteredAssets[0];
  }

  // 5. No filename: use default {{SYSTEM}}-{{ARCH}} regex.
  const defaultPattern = replacePlatformPlaceholders('{{SYSTEM}}[_-]{{ARCH}}', platform);
  const defaultFilteredAssets = filterByRegex(fileTypeFilteredAssets, defaultPattern);

  // 6. Zero or multiple matches are errors.
  if (defaultFilteredAssets.length !== 1) {
    const errorMessage = defaultFilteredAssets.length === 0
      ? `No assets matched the default criteria: ${defaultPattern}`
      : `Multiple assets matched the default criteria: ${defaultFilteredAssets.map((asset) => asset.name).join(', ')}`;
    throw new Error(errorMessage);
  }
  return defaultFilteredAssets[0];
}
