#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli.ts
var path3 = __toESM(require("path"));
var fs3 = __toESM(require("fs"));
var os2 = __toESM(require("os"));
var import_child_process2 = require("child_process");

// src/core/platform.ts
var os = __toESM(require("os"));
var systemPatterns = {
  linux: "linux",
  darwin: "(darwin|macos|mac|osx)",
  win32: "(windows|win)"
};
var archPatterns = {
  x64: "(x86_64|x64|amd64)",
  arm64: "(aarch64|arm64)"
};
function getPlatformInfo(overrides) {
  const system = (overrides?.system || os.platform()).toLowerCase();
  const arch2 = (overrides?.arch || os.arch()).toLowerCase();
  return {
    system,
    arch: arch2,
    systemPattern: systemPatterns[system] || system,
    archPattern: archPatterns[arch2] || arch2
  };
}

// src/core/matcher.ts
function normalizeCustomExtensionPattern(fileType) {
  let pattern = fileType;
  if (!pattern.endsWith("$")) {
    pattern += "$";
  }
  if (!pattern.startsWith("\\.")) {
    pattern = `\\.${pattern}`;
  }
  return pattern;
}
function getExtPattern(fileType, system) {
  const normalizedType = (fileType || "").toLowerCase();
  if (!normalizedType) {
    if (system === "linux") {
      return "\\.(deb|rpm|zip|tar\\.gz|tgz)$";
    }
    if (system === "darwin" || system === "macos" || system === "mac" || system === "osx") {
      return "\\.(pkg|zip|tar\\.gz|tgz)$";
    }
    return "\\.(zip|tar\\.gz|tgz)$";
  }
  if (normalizedType === "archive") {
    return "\\.(zip|tar\\.gz|tgz)$";
  }
  if (normalizedType === "package") {
    return "\\.(deb|pkg|rpm)$";
  }
  const shorthandTypePatterns = {
    zip: "\\.(zip)$",
    gzip: "\\.(tar\\.gz|tgz)$",
    gz: "\\.(tar\\.gz|tgz)$",
    tar: "\\.(tar)$",
    "tar.gz": "\\.(tar\\.gz)$",
    tgz: "\\.(tgz)$",
    deb: "\\.(deb)$",
    pkg: "\\.(pkg)$",
    rpm: "\\.(rpm)$"
  };
  if (shorthandTypePatterns[normalizedType]) {
    return shorthandTypePatterns[normalizedType];
  }
  return normalizeCustomExtensionPattern(fileType || "");
}
function getMatchingAsset(assets, platform2, options) {
  const { fileName, fileType } = options;
  const extPattern = getExtPattern(fileType, platform2.system);
  if (!fileName) {
    const pattern = `${platform2.systemPattern}[_-]${platform2.archPattern}.*${extPattern}`;
    const regex = new RegExp(pattern, "i");
    const matchingAssets = assets.filter((a) => regex.test(a.name));
    if (matchingAssets.length === 0) {
      throw new Error(`No assets matched the default criteria: ${pattern}`);
    }
    if (matchingAssets.length > 1) {
      throw new Error(`Multiple assets matched the default criteria: ${matchingAssets.map((a) => a.name).join(", ")}`);
    }
    return matchingAssets[0];
  } else if (fileName.startsWith("~")) {
    let pattern = fileName.substring(1);
    const hasSystem = pattern.includes("{{SYSTEM}}");
    const hasArch = pattern.includes("{{ARCH}}");
    const hasExt = pattern.includes("{{EXT_PATTERN}}");
    const hasEnd = pattern.endsWith("$");
    if (!hasSystem && !hasArch && !hasExt && !hasEnd) {
      pattern += `.*{{SYSTEM}}[_-]{{ARCH}}.*{{EXT_PATTERN}}$`;
    } else if (hasSystem && hasArch && !hasExt && !hasEnd) {
      pattern += `.*{{EXT_PATTERN}}$`;
    }
    const finalPattern = pattern.replace(/{{SYSTEM}}/g, platform2.systemPattern).replace(/{{ARCH}}/g, platform2.archPattern).replace(/{{EXT_PATTERN}}/g, extPattern);
    const regex = new RegExp(finalPattern, "i");
    const matchingAssets = assets.filter((a) => regex.test(a.name));
    if (matchingAssets.length === 0) {
      throw new Error(`No assets matched the regex: ${finalPattern}`);
    }
    if (matchingAssets.length > 1) {
      throw new Error(`Multiple assets matched the criteria: ${matchingAssets.map((a) => a.name).join(", ")}`);
    }
    return matchingAssets[0];
  } else {
    const asset = assets.find((a) => a.name === fileName);
    if (!asset) {
      throw new Error(`No asset found matching the exact name: ${fileName}`);
    }
    return asset;
  }
}

// src/core/finder.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
function findBinary(dir, pattern, debug, logger) {
  const items = fs.readdirSync(dir);
  if (debug) {
    logger(`Searching for binary in ${dir}...`);
    items.forEach((item) => logger(` - ${item}`));
  }
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const found = findBinary(fullPath, pattern, debug, logger);
      if (found) return found;
    } else {
      let isMatch = false;
      if (pattern instanceof RegExp) {
        isMatch = pattern.test(item);
      } else {
        isMatch = item === pattern;
        if (!isMatch && process.platform === "win32" && !pattern.toLowerCase().endsWith(".exe")) {
          isMatch = item.toLowerCase() === `${pattern.toLowerCase()}.exe`;
        }
      }
      if (isMatch) return fullPath;
    }
  }
  return void 0;
}

// src/core/downloader.ts
function getGithubApiHeaders(token) {
  const headers = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "setup-github-release-action"
  };
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }
  return headers;
}
async function fetchLatestRelease(repository, token) {
  const url = `https://api.github.com/repos/${repository}/releases/latest`;
  const headers = getGithubApiHeaders(token);
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch latest release for ${repository}: ${response.statusText}. ${errorBody}`);
  }
  return await response.json();
}
async function fetchLatestReleaseRaw(repository, token) {
  const url = `https://api.github.com/repos/${repository}/releases/latest`;
  const headers = getGithubApiHeaders(token);
  const response = await fetch(url, { headers });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to fetch latest release for ${repository}: ${response.statusText}. ${body}`);
  }
  return body;
}
async function downloadAsset(url, destPath, token) {
  const headers = {
    "User-Agent": "setup-github-release-action"
  };
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download asset: ${response.statusText}`);
  }
  const fs4 = await import("fs");
  const { Readable } = await import("stream");
  const { finished } = await import("stream/promises");
  const fileStream = fs4.createWriteStream(destPath);
  await finished(Readable.fromWeb(response.body).pipe(fileStream));
}

// src/core/extractor.ts
var import_child_process = require("child_process");
var path2 = __toESM(require("path"));
var fs2 = __toESM(require("fs"));
async function extractAsset(filePath, destDir) {
  const ext = path2.extname(filePath).toLowerCase();
  const name = path2.basename(filePath).toLowerCase();
  if (!fs2.existsSync(destDir)) {
    fs2.mkdirSync(destDir, { recursive: true });
  }
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz") || name.endsWith(".tar")) {
    const args = ["-xf", filePath, "-C", destDir];
    const result = (0, import_child_process.spawnSync)("tar", args);
    if (result.status !== 0) {
      throw new Error(`tar failed with status ${result.status}: ${result.stderr.toString()}`);
    }
  } else if (name.endsWith(".zip")) {
    if (process.platform === "win32") {
      const tarResult = (0, import_child_process.spawnSync)("tar", ["-xf", filePath, "-C", destDir]);
      if (tarResult.status === 0) return;
      const escapedFilePath = filePath.replace(/'/g, "''");
      const escapedDestDir = destDir.replace(/'/g, "''");
      const dotNetCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedFilePath}', '${escapedDestDir}')`;
      for (const shell of ["pwsh", "powershell"]) {
        const result = (0, import_child_process.spawnSync)(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", dotNetCommand]);
        if (result.status === 0) return;
      }
      throw new Error(`Extraction failed: Both tar and PowerShell fallback failed. Make sure your system can extract ZIP files.`);
    } else {
      const result = (0, import_child_process.spawnSync)("unzip", ["-q", filePath, "-d", destDir]);
      if (result.status !== 0) {
        throw new Error(`unzip failed with status ${result.status}: ${result.stderr.toString()}`);
      }
    }
  } else if (name.endsWith(".7z")) {
    const result = (0, import_child_process.spawnSync)("7z", ["x", filePath, `-o${destDir}`, "-y"]);
    if (result.status !== 0) {
      throw new Error(`7z failed with status ${result.status}. Make sure 7z is installed.`);
    }
  } else {
    const destPath = path2.join(destDir, path2.basename(filePath));
    fs2.copyFileSync(filePath, destPath);
  }
}

// src/cli.ts
function usage() {
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
function ensureOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}
function parseCliArgs(argv) {
  const envDryRun = process.env.TEST_MODE;
  const dryRunLevelFromEnv = envDryRun && /^\d+$/.test(envDryRun) ? parseInt(envDryRun, 10) : 0;
  const opts = {
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
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--dry-run": {
        const next = argv[i + 1];
        if (next && /^\d+$/.test(next)) {
          opts.dryRunLevel = parseInt(next, 10);
          i++;
        } else {
          opts.dryRunLevel = 1;
        }
        break;
      }
      case "-l":
      case "--list": {
        opts.listOnly = true;
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          opts.listRepo = next;
          i++;
        }
        break;
      }
      case "-a":
      case "--app-name":
        opts.appName = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case "-f":
      case "--file-name":
        opts.fileName = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case "-b":
      case "--binary-name":
        opts.binaryName = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case "-t":
      case "--file-type": {
        const fileType = ensureOptionValue(argv, i, arg).toLowerCase();
        const knownType = /^(archive|package|zip|gzip|gz|tar|tar\.gz|tgz|deb|pkg|rpm)$/i;
        if (!knownType.test(fileType)) {
          throw new Error(`Unknown asset type: ${fileType}`);
        }
        opts.fileType = fileType;
        i++;
        break;
      }
      case "-p":
      case "--install-path":
        opts.installPath = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case "-o":
      case "--output-directory":
        opts.outputDirectory = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case "-j":
      case "--releases-json":
        opts.releasesJsonOnly = true;
        break;
      case "--system":
        opts.systemOverride = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case "--arch":
        opts.archOverride = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case "-k":
      case "--token":
        opts.token = ensureOptionValue(argv, i, arg);
        i++;
        break;
      case "-d":
      case "--debug":
        opts.debug = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        opts.positionals.push(arg);
        break;
    }
  }
  return opts;
}
function validateOutputDirectory(outputDirectory) {
  const resolvedPath = path3.resolve(outputDirectory);
  if (!fs3.existsSync(resolvedPath) || !fs3.statSync(resolvedPath).isDirectory()) {
    throw new Error(`Output directory "${resolvedPath}" does not exist.`);
  }
  return resolvedPath;
}
function getInstallDir(installPath) {
  if (installPath) {
    return path3.resolve(installPath);
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path3.join(os2.homedir(), "AppData", "Local");
    return path3.join(localAppData, "bin");
  }
  const isRoot = process.getuid && process.getuid() === 0;
  if (isRoot) {
    return "/usr/local/bin";
  }
  const homeBin = path3.join(os2.homedir(), "bin");
  if (fs3.existsSync(homeBin)) {
    return homeBin;
  }
  return "/usr/local/bin";
}
function installSystemPackage(downloadPath) {
  const fileName = path3.basename(downloadPath).toLowerCase();
  const command = fileName.endsWith(".deb") ? { binary: "dpkg", args: ["-i", downloadPath] } : fileName.endsWith(".pkg") ? { binary: "installer", args: ["-pkg", downloadPath, "-target", "/"] } : fileName.endsWith(".rpm") ? { binary: "rpm", args: ["-i", downloadPath] } : void 0;
  if (!command) {
    throw new Error(`Unsupported package type: ${fileName}`);
  }
  const isRoot = process.getuid && process.getuid() === 0;
  const commandToRun = isRoot ? command.binary : "sudo";
  const argsToRun = isRoot ? command.args : [command.binary, ...command.args];
  const result = (0, import_child_process2.spawnSync)(commandToRun, argsToRun, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Failed to install package using ${commandToRun} ${argsToRun.join(" ")}.`);
  }
}
async function run() {
  let tempDir;
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const repository = options.listRepo || options.positionals[0];
    if (options.help || !repository) {
      console.log(usage());
      process.exit(options.help ? 0 : 1);
    }
    const token = options.token || process.env.GITHUB_TOKEN;
    if (options.listOnly) {
      const release2 = await fetchLatestRelease(repository, token);
      release2.assets.forEach((asset2) => console.log(`- ${asset2.browser_download_url}`));
      process.exit(0);
    }
    const toolName = repository.split("/").pop() || repository;
    const appName = options.appName || toolName.charAt(0).toUpperCase() + toolName.slice(1);
    const binaryOption = options.binaryName || toolName;
    const [binarySource, binaryDestination] = binaryOption.includes(":") ? [binaryOption.split(":")[0], binaryOption.split(":")[1]] : [binaryOption, binaryOption];
    if (options.releasesJsonOnly) {
      const rawRelease = await fetchLatestReleaseRaw(repository, token);
      const outputBase = binaryDestination || toolName;
      const outputName = `${outputBase}.releases.json`;
      const outputPath = options.outputDirectory ? path3.join(validateOutputDirectory(options.outputDirectory), outputName) : outputName;
      fs3.writeFileSync(outputPath, rawRelease, "utf8");
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
    const version = release.tag_name.replace(/^v/i, "");
    const downloadUrl = asset.browser_download_url;
    console.log(`Will download '${appName}' version: ${version}`);
    console.log(`Download URL: "${downloadUrl}".`);
    if (options.dryRunLevel > 0) {
      process.exit(0);
    }
    if (options.outputDirectory) {
      const outputDir = validateOutputDirectory(options.outputDirectory);
      const outputPath = path3.join(outputDir, path3.basename(downloadUrl));
      console.log(`Downloading '${appName}' version ${version} to '${outputPath}'...`);
      await downloadAsset(downloadUrl, outputPath, token);
      process.exit(0);
    }
    tempDir = fs3.mkdtempSync(path3.join(os2.tmpdir(), "setup-gh-release-"));
    const downloadPath = path3.join(tempDir, asset.name);
    await downloadAsset(downloadUrl, downloadPath, token);
    if (/\.(deb|pkg|rpm)$/i.test(asset.name)) {
      installSystemPackage(downloadPath);
      console.log("Installation successful!");
      process.exit(0);
    }
    const extractDir = path3.join(tempDir, "extract");
    console.log(`Extracting ${asset.name}...`);
    await extractAsset(downloadPath, extractDir);
    let binaryPattern;
    if (binarySource.startsWith("~")) {
      binaryPattern = new RegExp(binarySource.substring(1), "i");
    } else {
      binaryPattern = binarySource;
    }
    const binaryPath = findBinary(extractDir, binaryPattern, options.debug, console.log);
    if (!binaryPath) {
      throw new Error(`Could not find binary "${binarySource}" in the extracted asset.`);
    }
    const installDir = getInstallDir(options.installPath);
    if (!fs3.existsSync(installDir)) {
      fs3.mkdirSync(installDir, { recursive: true });
    }
    const finalName = binaryDestination || path3.basename(binaryPath);
    const destPath = path3.join(installDir, finalName);
    console.log(`Installing ${finalName} to ${destPath}...`);
    try {
      fs3.copyFileSync(binaryPath, destPath);
    } catch (err) {
      if (err.code === "EBUSY") {
        throw new Error(`The file ${destPath} is currently in use. Please close any running instances and try again.`);
      }
      if (err.code === "EACCES" || err.code === "EPERM") {
        throw new Error(`Permission denied while installing to ${destPath}. Try running with sudo or as administrator, or use -p to specify a custom path.`);
      }
      throw err;
    }
    if (process.platform !== "win32") {
      fs3.chmodSync(destPath, "755");
    }
    console.log("Installation successful!");
    process.exit(0);
  } catch (error) {
    if (error?.message) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Error: Unknown failure.");
    }
    process.exit(1);
  } finally {
    if (tempDir && fs3.existsSync(tempDir)) {
      fs3.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
run();
