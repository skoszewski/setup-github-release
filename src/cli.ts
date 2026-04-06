import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { getPlatformInfo } from './core/platform';
import { getMatchingAsset } from './core/matcher';
import { findBinary } from './core/finder';
import { fetchLatestRelease, fetchLatestReleaseRaw, downloadAsset } from './core/downloader';
import { extractAsset } from './core/extractor';

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
  help: boolean;
  dryRunLevel: number;
  systemOverride?: string;
  archOverride?: string;
  listRepo?: string;
  positionals: string[];
}

function usage(): string {
  return `
Usage: install-github-release [options] <repository>

Arguments:
  repository                 The GitHub repository (owner/repo)

Options:
  --dry-run [level]          Run in test mode (default level: 1)
  -l, --list [repository]    List available assets from latest release and exit
  -a, --app-name <name>      Application name (optional, for output messages)
  -f, --file-name <name>     Asset file name or regex pattern (prefixed with ~)
  -b, --binary-name <name>   Binary name (supports source:destination form)
  -t, --file-type <type>     archive|package|zip|gzip|gz|tar|tar.gz|tgz|deb|pkg|rpm
  -p, --install-path <path>  Custom installation directory
  -o, --output-directory <path>
                             Only download selected asset to the specified directory
  -j, --releases-json        Download latest release JSON only
  --system <name>            Override detected system for asset matching
  --arch <name>              Override detected architecture for asset matching
  -k, --token <token>        GitHub token
  -d, --debug                Enable debug logging
  -h, --help                 Show this help message
  `;
}

function ensureOptionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

function parseCliArgs(argv: string[]): CliOptions {
  const envDryRun = process.env.TEST_MODE;
  const dryRunLevelFromEnv = envDryRun && /^\d+$/.test(envDryRun) ? parseInt(envDryRun, 10) : 0;

  const opts: CliOptions = {
    releasesJsonOnly: false,
    listOnly: false,
    debug: false,
    help: false,
    dryRunLevel: dryRunLevelFromEnv,
    positionals: []
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--dry-run': {
        const next = argv[i + 1];
        if (next && /^\d+$/.test(next)) {
          opts.dryRunLevel = parseInt(next, 10);
          i++;
        } else {
          opts.dryRunLevel = 1;
        }
        break;
      }
      case '-l':
      case '--list': {
        opts.listOnly = true;
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          opts.listRepo = next;
          i++;
        }
        break;
      }
      case '-a':
      case '--app-name':
        opts.appName = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case '-f':
      case '--file-name':
        opts.fileName = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case '-b':
      case '--binary-name':
        opts.binaryName = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case '-t':
      case '--file-type': {
        const fileType = ensureOptionValue(argv, i, arg).toLowerCase();
        const knownType = /^(archive|package|zip|gzip|gz|tar|tar\.gz|tgz|deb|pkg|rpm)$/i;
        if (!knownType.test(fileType)) {
          throw new Error(`Unknown asset type: ${fileType}`);
        }
        opts.fileType = fileType;
        i++;
        break;
      }
      case '-p':
      case '--install-path':
        opts.installPath = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case '-o':
      case '--output-directory':
        opts.outputDirectory = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case '-j':
      case '--releases-json':
        opts.releasesJsonOnly = true;
        break;
      case '--system':
        opts.systemOverride = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case '--arch':
        opts.archOverride = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case '-k':
      case '--token':
        opts.token = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case '-d':
      case '--debug':
        opts.debug = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        opts.positionals.push(arg);
        break;
    }
  }

  return opts;
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

async function run() {
  let tempDir: string | undefined;
  try {
    const options = parseCliArgs(process.argv.slice(2));

    const repository = options.listRepo || options.positionals[0];
    if (options.help || !repository) {
      console.log(usage());
      process.exit(options.help ? 0 : 1);
    }

    const token = options.token || process.env.GITHUB_TOKEN;

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
    const asset = getMatchingAsset(release.assets, platformInfo, {
      fileName: options.fileName,
      fileType: options.fileType
    });

    const version = release.tag_name.replace(/^v/i, '');
    const downloadUrl = asset.browser_download_url;
    console.log(`Will download '${appName}' version: ${version}`);
    console.log(`Download URL: "${downloadUrl}".`);

    if (options.dryRunLevel > 0) {
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

    let binaryPattern: string | RegExp;
    if (binarySource.startsWith('~')) {
      binaryPattern = new RegExp(binarySource.substring(1), 'i');
    } else {
      binaryPattern = binarySource;
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
    try {
      fs.copyFileSync(binaryPath, destPath);
    } catch (err: any) {
      if (err.code === 'EBUSY') {
        throw new Error(`The file ${destPath} is currently in use. Please close any running instances and try again.`);
      }
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new Error(`Permission denied while installing to ${destPath}. Try running with sudo or as administrator, or use -p to specify a custom path.`);
      }
      throw err;
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(destPath, '755');
    }

    console.log('Installation successful!');
    process.exit(0);
  } catch (error: any) {
    if (error?.message) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('Error: Unknown failure.');
    }
    process.exit(1);
  } finally {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

run();
