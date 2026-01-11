import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

function findBinary(dir: string, pattern: string | RegExp, debug: boolean): string | undefined {
  const items = fs.readdirSync(dir);
  if (debug) {
    core.info(`Searching for binary in ${dir}...`);
    items.forEach(item => core.info(` - ${item}`));
  }

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const found = findBinary(fullPath, pattern, debug);
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

async function run() {
  try {
    const repository = core.getInput('repository', { required: true });
    let fileName = core.getInput('file-name');
    const binaryInput = core.getInput('binary-name');
    const fileType = core.getInput('file-type') || 'archive';
    const updateCache = core.getInput('update-cache') || 'false';
    const debug = core.getBooleanInput('debug');
    const token = core.getInput('token') || process.env.GITHUB_TOKEN;

    // Detect system and architecture
    const platform = os.platform(); // 'linux', 'darwin', 'win32'
    const arch = os.arch(); // 'x64', 'arm64'

    const toolName = repository.split('/').pop() || repository;

    // Rule for update-cache: 'false' means use ANY cached version if available
    if (updateCache === 'false') {
      const allVersions = tc.findAllVersions(toolName, arch);
      if (allVersions.length > 0) {
        // Simple sort to pick the 'latest' local version
        const latestVersion = allVersions.sort().pop();
        if (latestVersion) {
          const cachedDir = tc.find(toolName, latestVersion, arch);
          if (cachedDir) {
            core.info(`Found ${toolName} version ${latestVersion} in local cache (update-cache: false)`);
            core.addPath(cachedDir);
            return;
          }
        }
      }
    }

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

    const url = `https://api.github.com/repos/${repository}/releases/latest`;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'setup-github-release-action'
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    core.info(`Fetching latest release information for ${repository}...`);
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch release: ${response.statusText} (${response.status})`);
    }

    const data: any = await response.json();
    let asset;

    if (!fileName) {
      // Rule 1: Default matching rule
      const pattern = `${systemPattern}[_-]${archPattern}.*${extPattern}$`;
      const regex = new RegExp(pattern, 'i');
      core.info(`No file-name provided. Using default pattern: ${pattern}`);
      const matchingAssets = data.assets.filter((a: any) => regex.test(a.name));
      if (matchingAssets.length === 0) {
        throw new Error(`No assets matched the default criteria: ${pattern}`);
      }
      if (matchingAssets.length > 1) {
        throw new Error(`Multiple assets matched the default criteria: ${matchingAssets.map((a: any) => a.name).join(', ')}`);
      }
      asset = matchingAssets[0];
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
        .replace(/{{SYSTEM}}/g, systemPattern)
        .replace(/{{ARCH}}/g, archPattern)
        .replace(/{{EXT_PATTERN}}/g, extPattern);

      const regex = new RegExp(finalPattern, 'i');
      core.info(`Using regex pattern: ${finalPattern}`);
      const matchingAssets = data.assets.filter((a: any) => regex.test(a.name));
      if (matchingAssets.length === 0) {
        throw new Error(`No assets matched the regex: ${finalPattern}`);
      }
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

    const version = data.tag_name.replace(/^v/, '');
    const binaryName = binaryInput || toolName;

    // Check if the tool is already in the cache (if not 'always' update)
    if (updateCache !== 'always') {
      const cachedDir = tc.find(toolName, version, arch);
      if (cachedDir) {
        core.info(`Found ${toolName} version ${version} in cache at ${cachedDir}`);
        core.addPath(cachedDir);
        return;
      }
    }

    const downloadUrl = asset.browser_download_url;
    core.info(`Downloading ${asset.name} from ${downloadUrl}...`);

    const downloadPath = await tc.downloadTool(downloadUrl);

    const nameLower = asset.name.toLowerCase();
    let toolDir: string;

    // Determine extraction method based on extension
    if (/\.(tar\.gz|tar|tgz)$/i.test(nameLower)) {
      toolDir = await tc.extractTar(downloadPath);
    } else if (/\.zip$/i.test(nameLower)) {
      toolDir = await tc.extractZip(downloadPath);
    } else if (/\.7z$/i.test(nameLower)) {
      toolDir = await tc.extract7z(downloadPath);
    } else if (/\.(xar|pkg)$/i.test(nameLower)) {
      toolDir = await tc.extractXar(downloadPath);
    } else {
      // Treat as a direct binary or non-extractable file
      toolDir = path.join(path.dirname(downloadPath), 'bin');
      const destPath = path.join(toolDir, asset.name);

      if (!fs.existsSync(toolDir)) {
        fs.mkdirSync(toolDir, { recursive: true });
      }
      fs.renameSync(downloadPath, destPath);

      // Make it executable on Linux/macOS
      if (process.platform !== 'win32') {
        fs.chmodSync(destPath, '755');
      }
    }

    // Find the binary within the extracted/prepared directory
    let binaryPattern: string | RegExp;
    if (binaryName.startsWith('~')) {
      binaryPattern = new RegExp(binaryName.substring(1), 'i');
      core.info(`Searching for binary matching regex: ${binaryName.substring(1)}`);
    } else {
      binaryPattern = binaryName;
      core.info(`Searching for binary named: ${binaryName}`);
    }

    const binaryPath = findBinary(toolDir, binaryPattern, debug);
    if (!binaryPath) {
      throw new Error(`Could not find binary "${binaryName}" in the extracted asset.`);
    }

    // The tool directory is the one containing the binary
    toolDir = path.dirname(binaryPath);
    core.info(`Binary found at ${binaryPath}. Setting tool directory to ${toolDir}`);

    // Make binary executable just in case it's not
    if (process.platform !== 'win32') {
      fs.chmodSync(binaryPath, '755');
    }

    // Cache the tool
    const finalCachedDir = await tc.cacheDir(toolDir, toolName, version, arch);
    core.info(`Cached ${toolName} version ${version} to ${finalCachedDir}`);

    core.addPath(finalCachedDir);
    core.info(`Added ${finalCachedDir} to PATH`);

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
