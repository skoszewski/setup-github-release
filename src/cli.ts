import { parseArgs } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getPlatformInfo } from './core/platform';
import { getMatchingAsset } from './core/matcher';
import { findBinary } from './core/finder';
import { fetchLatestRelease, downloadAsset } from './core/downloader';
import { extractAsset } from './core/extractor';

async function run() {
  const { values, positionals } = parseArgs({
    options: {
      'file-name': { type: 'string', short: 'f' },
      'binary-name': { type: 'string', short: 'b' },
      'file-type': { type: 'string', short: 't', default: 'archive' },
      'install-path': { type: 'string', short: 'p' },
      'token': { type: 'string', short: 'k' },
      'debug': { type: 'boolean', short: 'd', default: false },
      'help': { type: 'boolean', short: 'h' }
    },
    allowPositionals: true
  });

  if (values.help || positionals.length === 0) {
    console.log(`
Usage: install-github-release [options] <repository>

Arguments:
  repository                 The GitHub repository (owner/repo)

Options:
  -f, --file-name <name>     Asset file name or regex pattern (prefixed with ~)
  -b, --binary-name <name>   Binary to search for (prefixed with ~ for regex)
  -t, --file-type <type>     'archive', 'package', or custom regex (default: archive)
  -p, --install-path <path>  Custom installation directory
  -k, --token <token>        GitHub token
  -d, --debug                Enable debug logging
  -h, --help                 Show this help message
    `);
    process.exit(0);
  }

  const repository = positionals[0];
  if (!repository) {
    console.error('Error: Repository is required.');
    process.exit(1);
  }

  const fileNameInput = values['file-name'];
  const binaryInput = values['binary-name'];
  const fileType = values['file-type'];
  const debug = !!values.debug;
  const token = values.token || process.env.GITHUB_TOKEN;

  try {
    const platformInfo = getPlatformInfo();
    const toolName = repository.split('/').pop() || repository;

    console.log(`Fetching latest release for ${repository}...`);
    const release = await fetchLatestRelease(repository, token);
    const asset = getMatchingAsset(release.assets, platformInfo, {
      fileName: fileNameInput,
      fileType: fileType
    });

    console.log(`Selected asset: ${asset.name}`);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-gh-release-'));
    const downloadPath = path.join(tempDir, asset.name);

    console.log(`Downloading ${asset.name}...`);
    await downloadAsset(asset.browser_download_url, downloadPath, token);

    const extractDir = path.join(tempDir, 'extract');
    console.log(`Extracting ${asset.name}...`);
    await extractAsset(downloadPath, extractDir);

    const binaryName = binaryInput || toolName;
    let binaryPattern: string | RegExp;
    if (binaryName.startsWith('~')) {
      binaryPattern = new RegExp(binaryName.substring(1), 'i');
    } else {
      binaryPattern = binaryName;
    }

    const binaryPath = findBinary(extractDir, binaryPattern, debug, console.log);
    if (!binaryPath) {
      throw new Error(`Could not find binary "${binaryName}" in the extracted asset.`);
    }

    // Determine install directory
    let installDir: string;

    if (values['install-path']) {
      installDir = path.resolve(values['install-path']);
    } else {
      const isRoot = process.getuid && process.getuid() === 0;

      if (isRoot) {
        installDir = '/usr/local/bin';
      } else {
        const homeBin = path.join(os.homedir(), 'bin');
        if (fs.existsSync(homeBin)) {
          installDir = homeBin;
        } else {
          // Fallback or error? Let's use a local bin if possible or /usr/local/bin (might fail)
          installDir = '/usr/local/bin';
        }
      }
    }

    if (!fs.existsSync(installDir)) {
      fs.mkdirSync(installDir, { recursive: true });
    }

    const finalName = path.basename(binaryPath);
    const destPath = path.join(installDir, finalName);

    console.log(`Installing ${finalName} to ${destPath}...`);
    fs.copyFileSync(binaryPath, destPath);
    
    if (process.platform !== 'win32') {
      fs.chmodSync(destPath, '755');
    }

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log('Installation successful!');

  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

run();
