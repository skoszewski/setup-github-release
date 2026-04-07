import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Command } from 'commander';
import { getPlatformInfo } from './core/platform';
import { getMatchingAsset } from './core/matcher';
import { findBinary } from './core/finder';
import { fetchLatestRelease, fetchLatestReleaseRaw, downloadAsset } from './core/downloader';
import { extractAsset } from './core/extractor';
import { installSystemPackage } from './core/installer';

interface CliOptions {
  appName?: string;
  fileName?: string;
  binaryName?: string;
  fileType?: string;
  installPath?: string;
  outputDirectory?: string;
  releasesJsonOnly: boolean;
  listOnly: boolean;
  token?: string;
  debug: boolean;
  dryRun: boolean;
  systemOverride?: string;
  archOverride?: string;
  listRepo?: string;
  positionals: string[];
}

function validateOutputDirectory(outputDirectory: string): string {
  const resolvedPath = path.resolve(outputDirectory);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`Output directory "${resolvedPath}" does not exist.`);
  }
  return resolvedPath;
}

function getInstallDir(installPath?: string): string {
  if (installPath) {
    return path.resolve(installPath);
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'bin');
  }

  const isRoot = process.getuid && process.getuid() === 0;
  if (isRoot) {
    return '/usr/local/bin';
  }

  const homeBin = path.join(os.homedir(), 'bin');
  if (fs.existsSync(homeBin)) {
    return homeBin;
  }

  return '/usr/local/bin';
}

async function run() {
  let tempDir: string | undefined;
  const program = new Command();
  program
    .name('install-github-release')
    .usage('[options] <repository>')
    .argument('[repository]', 'The GitHub repository (owner/repo)')
    .option('--dry-run', 'Run in test mode')
    .option('-l, --list [repository]', 'List available assets from latest release and exit')
    .option('-a, --app-name <name>', 'Application name (optional, for output messages)')
    .option('-f, --file-name <name>', 'Asset file name or regex pattern (prefixed with ~)')
    .option('-b, --binary-name <name>', 'Binary name (supports source:destination form)')
    .option('-t, --file-type <type>', 'Known: archive|package|linux|macos|targz; custom: ~<regex> or extension')
    .option('-p, --install-path <path>', 'Custom installation directory')
    .option('-o, --output-directory <path>', 'Only download selected asset to the specified directory')
    .option('-j, --releases-json', 'Download latest release JSON only')
    .option('--system <name>', 'Override detected system for asset matching')
    .option('--arch <name>', 'Override detected architecture for asset matching')
    .option('-k, --token <token>', 'GitHub token')
    .option('-d, --debug', 'Enable debug logging')
    .allowUnknownOption(false);

  const cleanupTempDir = () => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };

  program.parse(process.argv);
  const parsedOptions = program.opts();
  const rawFileType = parsedOptions.fileType;
  const fileType = typeof rawFileType === 'string' ? rawFileType.trim() : undefined;
  if (rawFileType !== undefined && !fileType) {
    throw new Error(`Unknown asset type: ${rawFileType}`);
  }

  const listValue = parsedOptions.list as string | boolean | undefined;
  const options: CliOptions = {
    appName: parsedOptions.appName as string | undefined,
    fileName: parsedOptions.fileName as string | undefined,
    binaryName: parsedOptions.binaryName as string | undefined,
    fileType,
    installPath: parsedOptions.installPath as string | undefined,
    outputDirectory: parsedOptions.outputDirectory as string | undefined,
    releasesJsonOnly: Boolean(parsedOptions.releasesJson),
    listOnly: listValue !== undefined,
    token: parsedOptions.token as string | undefined,
    debug: Boolean(parsedOptions.debug),
    dryRun: Boolean(parsedOptions.dryRun),
    systemOverride: parsedOptions.system as string | undefined,
    archOverride: parsedOptions.arch as string | undefined,
    listRepo: typeof listValue === 'string' ? listValue : undefined,
    positionals: program.args
  };

  const repository = options.listRepo || options.positionals[0];
  if (!repository) {
    program.outputHelp();
    process.exit(1);
  }

  const token = options.token;

  if (options.listOnly) {
    const release = await fetchLatestRelease(repository, token);
    release.assets.forEach((asset) => console.log(`- ${asset.browser_download_url}`));
    process.exit(0);
  }

  const toolName = repository.split('/').pop() || repository;
  const appName = options.appName || (toolName.charAt(0).toUpperCase() + toolName.slice(1));

  const binaryOption = options.binaryName || toolName;
  const [binarySource, binaryDestination] = binaryOption.includes(':')
    ? [binaryOption.split(':')[0], binaryOption.split(':')[1]]
    : [binaryOption, binaryOption];

  if (options.releasesJsonOnly) {
    const rawRelease = await fetchLatestReleaseRaw(repository, token);
    const outputBase = binaryDestination || toolName;
    const outputName = `${outputBase}.releases.json`;
    const outputPath = options.outputDirectory
      ? path.join(validateOutputDirectory(options.outputDirectory), outputName)
      : outputName;

    fs.writeFileSync(outputPath, rawRelease, 'utf8');
    console.log(`Downloaded GitHub releases to ${outputPath}.`);
    process.exit(0);
  }

  const platformInfo = getPlatformInfo({
    system: options.systemOverride,
    arch: options.archOverride
  });

  console.log(`Fetching latest release for ${repository}...`);
  const release = await fetchLatestRelease(repository, token);
  const asset = getMatchingAsset(release.assets, platformInfo, options.fileName, options.fileType, options.dryRun);

  const version = release.tag_name.replace(/^v/i, '');
  const downloadUrl = asset.browser_download_url;
  console.log(`Will download '${appName}' version: ${version}`);
  console.log(`Download URL: "${downloadUrl}".`);

  if (options.dryRun) {
    process.exit(0);
  }

  if (options.outputDirectory) {
    const outputDir = validateOutputDirectory(options.outputDirectory);
    const outputPath = path.join(outputDir, path.basename(downloadUrl));
    console.log(`Downloading '${appName}' version ${version} to '${outputPath}'...`);
    await downloadAsset(downloadUrl, outputPath, token);
    process.exit(0);
  }

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-gh-release-'));
  process.once('exit', cleanupTempDir);
  const downloadPath = path.join(tempDir, asset.name);
  await downloadAsset(downloadUrl, downloadPath, token);

  if (/\.(deb|pkg|rpm)$/i.test(asset.name)) {
    installSystemPackage(downloadPath);
    console.log('Installation successful!');
    process.exit(0);
  }

  const extractDir = path.join(tempDir, 'extract');
  console.log(`Extracting ${asset.name}...`);
  await extractAsset(downloadPath, extractDir);

  let binaryPattern: string;
  if (binarySource.startsWith('~')) {
    const binaryRegex = binarySource
      .substring(1)
      .replace(/{{SYSTEM}}/g, platformInfo.systemPattern)
      .replace(/{{ARCH}}/g, platformInfo.archPattern);
    binaryPattern = `~${binaryRegex}`;
  } else {
    binaryPattern = binarySource
      .replace(/{{SYSTEM}}/g, platformInfo.system)
      .replace(/{{ARCH}}/g, platformInfo.arch);
  }

  const binaryPath = findBinary(extractDir, binaryPattern, options.debug, console.log);
  if (!binaryPath) {
    throw new Error(`Could not find binary "${binarySource}" in the extracted asset.`);
  }

  const installDir = getInstallDir(options.installPath);
  if (!fs.existsSync(installDir)) {
    fs.mkdirSync(installDir, { recursive: true });
  }

  const finalName = binaryDestination || path.basename(binaryPath);
  const destPath = path.join(installDir, finalName);

  console.log(`Installing ${finalName} to ${destPath}...`);
  fs.copyFileSync(binaryPath, destPath);

  if (process.platform !== 'win32') {
    fs.chmodSync(destPath, '755');
  }

  console.log('Installation successful!');
  process.exit(0);
}

void run().catch((error: unknown) => {
  if (error instanceof Error && error.message) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error('Error: Unknown failure.');
  }
  process.exit(1);
});
