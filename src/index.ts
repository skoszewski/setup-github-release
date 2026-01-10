import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as path from 'path';
import * as os from 'os';

async function run() {
  try {
    const repoName = core.getInput('repo-name', { required: true });
    let fileName = core.getInput('file-name');
    const useRegex = core.getInput('use-regex') === 'true';
    const token = core.getInput('token') || process.env.GITHUB_TOKEN;

    if (!fileName) {
      throw new Error('file-name must be provided (either as a string or regex pattern)');
    }

    // Platform detection
    const platform = os.platform(); // 'linux', 'darwin', 'win32'
    let arch = os.arch(); // 'x64', 'arm64'

    // Normalize OS/Arch names for common release patterns
    const osMap: Record<string, string> = { 'win32': 'windows', 'darwin': 'darwin' };
    const archMap: Record<string, string> = { 'x64': 'amd64' };

    const currentOS = osMap[platform] || platform;
    const currentArch = archMap[arch] || arch;

    // Replace placeholders in fileName
    fileName = fileName.replace(/{{SYSTEM}}/g, currentOS).replace(/{{ARCH}}/g, currentArch);

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
    if (useRegex) {
      const regex = new RegExp(fileName);
      asset = data.assets.find((a: any) => regex.test(a.name));
    } else {
      asset = data.assets.find((a: any) => a.name === fileName);
    }

    if (!asset) {
      throw new Error(`Asset matching "${fileName}" not found in release ${data.tag_name}`);
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
