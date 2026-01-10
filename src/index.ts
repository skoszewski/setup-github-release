import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as path from 'path';
import * as os from 'os';

async function run() {
  try {
    const repoName = core.getInput('repo-name', { required: true });
    let fileName = core.getInput('file-name');
    const fileType = core.getInput('file-type') || 'archive';
    const token = core.getInput('token') || process.env.GITHUB_TOKEN;

    // Detect system and architecture
    const platform = os.platform(); // 'linux', 'darwin', 'win32'
    const arch = os.arch(); // 'x64', 'arm64'

    const systemPatterns: Record<string, string> = {
      linux: 'linux',
      darwin: '(darwin|macos|mac)',
      win32: '(windows|win)'
    };

    const archPatterns: Record<string, string> = {
      x64: '(x86_64|x64|amd64)',
      arm64: '(aarch64|arm64)'
    };

    const systemPattern = systemPatterns[platform] || platform;
    const archPattern = archPatterns[arch] || arch;

    let extPattern: string;
    if (fileType === 'archive') {
      extPattern = '\\.(zip|tar\\.gz|tar|tgz|7z)';
    } else if (fileType === 'package') {
      extPattern = '\\.(deb|rpm|pkg)';
    } else {
      extPattern = fileType;
    }

    const url = `https://api.github.com/repos/${repoName}/releases/latest`;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'setup-github-release-action'
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    core.info(`Fetching latest release information for ${repoName}...`);
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch release: ${response.statusText} (${response.status})`);
    }

    const data: any = await response.json();
    let asset;

    if (!fileName) {
      // Default matching rule
      const pattern = `${systemPattern}[_-]${archPattern}.*${extPattern}$`;
      const regex = new RegExp(pattern, 'i');
      core.info(`No file-name provided. Using default pattern: ${pattern}`);
      const matchingAssets = data.assets.filter((a: any) => regex.test(a.name));
      if (matchingAssets.length > 1) {
        throw new Error(`Multiple assets matched the default criteria: ${matchingAssets.map((a: any) => a.name).join(', ')}`);
      }
      asset = matchingAssets[0];
    } else if (fileName.startsWith('~')) {
      // Regex matching rule
      let pattern = fileName.substring(1);
      const hasSystem = pattern.includes('{{SYSTEM}}');
      const hasArch = pattern.includes('{{ARCH}}');
      const hasEnd = pattern.endsWith('$');

      if (!hasSystem && !hasArch && !hasEnd) {
        pattern += `.*${systemPattern}[_-]${archPattern}.*${extPattern}$`;
      } else if (hasSystem && hasArch && !hasEnd) {
        pattern += `.*${extPattern}$`;
      }

      pattern = pattern.replace(/{{SYSTEM}}/g, systemPattern).replace(/{{ARCH}}/g, archPattern);
      const regex = new RegExp(pattern, 'i');
      core.info(`Using regex pattern: ${pattern}`);
      const matchingAssets = data.assets.filter((a: any) => regex.test(a.name));
      if (matchingAssets.length > 1) {
        throw new Error(`Multiple assets matched the criteria: ${matchingAssets.map((a: any) => a.name).join(', ')}`);
      }
      asset = matchingAssets[0];
    } else {
      // Literal matching rule
      core.info(`Using literal match for: ${fileName}`);
      asset = data.assets.find((a: any) => a.name === fileName);
    }

    if (!asset) {
      throw new Error(`No asset found matching the criteria in release ${data.tag_name}`);
    }

    const downloadUrl = asset.browser_download_url;
    core.info(`Downloading ${asset.name} from ${downloadUrl}...`);

    const downloadPath = await tc.downloadTool(downloadUrl);
    core.info(`Downloaded to ${downloadPath}`);

    let toolDir: string;
    if (asset.name.endsWith('.tar.gz')) {
      toolDir = await tc.extractTar(downloadPath);
    } else if (asset.name.endsWith('.zip')) {
      toolDir = await tc.extractZip(downloadPath);
    } else {
      toolDir = path.dirname(downloadPath);
      // For single binaries, we often need to ensure they have the right name and are executable
      // However, downloadTool gives a random name. Let's stick to adding the directory to PATH for now.
    }

    core.info(`Tool extracted/located at ${toolDir}`);
    core.addPath(toolDir);
    core.info(`Added ${toolDir} to PATH`);

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
