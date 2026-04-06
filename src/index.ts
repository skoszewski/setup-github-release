import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { getPlatformInfo } from './core/platform';
import { getMatchingAsset } from './core/matcher';
import { findBinary } from './core/finder';
import { fetchLatestRelease } from './core/downloader';

function installSystemPackage(downloadPath: string): void {
  const fileName = path.basename(downloadPath).toLowerCase();

  const command: { binary: string; args: string[] } | undefined = fileName.endsWith('.deb')
    ? { binary: 'dpkg', args: ['-i', downloadPath] }
    : fileName.endsWith('.pkg')
      ? { binary: 'installer', args: ['-pkg', downloadPath, '-target', '/'] }
      : fileName.endsWith('.rpm')
        ? { binary: 'rpm', args: ['-i', downloadPath] }
        : undefined;

  if (!command) {
    throw new Error(`Unsupported package type: ${fileName}`);
  }

  const isRoot = process.getuid && process.getuid() === 0;
  const commandToRun = isRoot ? command.binary : 'sudo';
  const argsToRun = isRoot ? command.args : [command.binary, ...command.args];

  const result = spawnSync(commandToRun, argsToRun, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Failed to install package using ${commandToRun} ${argsToRun.join(' ')}.`);
  }
}

function findInstalledBinary(binaryName: string): string | undefined {
  const isRegex = binaryName.startsWith('~');
  if (!isRegex) {
    const whichResult = spawnSync('which', [binaryName], { encoding: 'utf8' });
    if (whichResult.status === 0) {
      const resolvedPath = (whichResult.stdout || '').trim();
      if (resolvedPath) {
        return resolvedPath;
      }
    }
  }

  const candidates = ['/usr/local/bin', '/usr/bin', '/opt/homebrew/bin', '/opt/local/bin'];
  const pattern: string | RegExp = isRegex ? new RegExp(binaryName.substring(1), 'i') : binaryName;
  for (const candidateDir of candidates) {
    if (!fs.existsSync(candidateDir)) {
      continue;
    }
    const candidatePath = findBinary(candidateDir, pattern, false, () => undefined);
    if (candidatePath) {
      return candidatePath;
    }
  }

  return undefined;
}

async function run() {
  try {
    const repository = core.getInput('repository', { required: true });
    const fileNameInput = core.getInput('file-name');
    const binaryInput = core.getInput('binary-name');
    const fileType = core.getInput('file-type');
    const updateCache = core.getInput('update-cache') || 'false';
    const debug = core.getBooleanInput('debug');
    const token = core.getInput('token') || process.env.GITHUB_TOKEN;

    const platformInfo = getPlatformInfo();
    const toolName = repository.split('/').pop() || repository;

    // Rule for update-cache: 'false' means use ANY cached version if available
    if (updateCache === 'false') {
      const allVersions = tc.findAllVersions(toolName, platformInfo.arch);
      if (allVersions.length > 0) {
        const latestVersion = allVersions.sort().pop();
        if (latestVersion) {
          const cachedDir = tc.find(toolName, latestVersion, platformInfo.arch);
          if (cachedDir) {
            core.info(`Found ${toolName} version ${latestVersion} in local cache (update-cache: false)`);
            core.addPath(cachedDir);
            return;
          }
        }
      }
    }

    core.info(`Fetching latest release information for ${repository}...`);
    const release = await fetchLatestRelease(repository, token);
    const asset = getMatchingAsset(release.assets, platformInfo, {
      fileName: fileNameInput,
      fileType: fileType
    });

    core.info(`Selected asset: ${asset.name}`);

    const version = release.tag_name.replace(/^v/, '');
    const binaryName = binaryInput || toolName;

    // Check if the tool is already in the cache (if not 'always' update)
    if (updateCache !== 'always') {
      const cachedDir = tc.find(toolName, version, platformInfo.arch);
      if (cachedDir) {
        core.info(`Found ${toolName} version ${version} in cache at ${cachedDir}`);
        core.addPath(cachedDir);
        return;
      }
    }

    const downloadUrl = asset.browser_download_url;
    core.info(`Downloading ${asset.name} from ${downloadUrl}...`);

    const downloadPath = await tc.downloadTool(downloadUrl, undefined, token ? `token ${token}` : undefined);

    const nameLower = asset.name.toLowerCase();
    let toolDir: string;

    if (/\.(deb|pkg|rpm)$/i.test(nameLower)) {
      core.info(`Installing package asset ${asset.name}...`);
      installSystemPackage(downloadPath);

      const binaryPath = findInstalledBinary(binaryName);
      if (!binaryPath) {
        throw new Error(`Package installed, but binary "${binaryName}" could not be located in common executable paths.`);
      }

      const binaryDir = path.dirname(binaryPath);
      core.addPath(binaryDir);
      core.info(`Binary found at ${binaryPath}. Added ${binaryDir} to PATH.`);
      return;
    }

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

    const binaryPath = findBinary(toolDir, binaryPattern, debug, (msg) => core.info(msg));
    if (!binaryPath) {
      throw new Error(`Could not find binary "${binaryName}" in the extracted asset.`);
    }

    // The tool directory is the one containing the binary
    toolDir = path.dirname(binaryPath);
    core.info(`Binary found at ${binaryPath}.`);

    // Make binary executable just in case it's not
    if (process.platform !== 'win32') {
      fs.chmodSync(binaryPath, '755');
    }

    // Cache the tool
    const finalCachedDir = await tc.cacheDir(toolDir, toolName, version, platformInfo.arch);
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
