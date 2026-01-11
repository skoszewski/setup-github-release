import { getMatchingAsset } from './matcher';
import { PlatformInfo } from './platform';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface ReleaseInfo {
  tag_name: string;
  assets: ReleaseAsset[];
}

export async function fetchLatestRelease(repository: string, token?: string): Promise<ReleaseInfo> {
  const url = `https://api.github.com/repos/${repository}/releases/latest`;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'setup-github-release-action'
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch latest release for ${repository}: ${response.statusText}. ${errorBody}`);
  }

  return await response.json() as ReleaseInfo;
}

export async function downloadAsset(url: string, destPath: string, token?: string): Promise<void> {
  const headers: Record<string, string> = {
    'User-Agent': 'setup-github-release-action'
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download asset: ${response.statusText}`);
  }

  const fs = await import('fs');
  const { Readable } = await import('stream');
  const { finished } = await import('stream/promises');

  const fileStream = fs.createWriteStream(destPath);
  await finished(Readable.fromWeb(response.body as any).pipe(fileStream));
}
