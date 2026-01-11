# Setup GitHub Release Action

This project implements a GitHub Action (`setup-github-release`) and a CLI tool (`install-github-release`) that downloads a release asset from a specified GitHub repository, extracts it, searches for a binary within the extracted files, and prepares the runtime environment.

## Installation / Setup

### GitHub/Gitea Action

Add the action to your workflow. Authenticate with `github.token` (default) or a custom token for Gitea/private repos.

```yaml
- name: Install Tool
  uses: skoszewski/setup-github-release@v1
  with:
    repository: 'owner/repo'
```

### CLI Tool

Install the CLI tool on any destination system with Node.js 24 or newer.

**From Source:**

1. Clone the repository:

```bash
git clone https://github.com/skoszewski/setup-github-release
cd setup-github-release
```

2. Install dependencies and build the project:

```bash
npm install
npm run build
```

3. Install the tool locally:

```bash
npm install -g .
```

After installation, the tool will be available as `install-github-release`. By default, it installs binaries to:

- Linux/macOS (root): `/usr/local/bin`
- Linux/macOS (user): `~/bin` (if exists) or `/usr/local/bin`
- Windows: `%LOCALAPPDATA%\bin`

```bash
install-github-release rclone/rclone
```

## Features

- **Automatic Platform Detection**: Detects OS and Architecture to find the right asset.
- **Recursive Binary Search**: Finds the executable even if it's nested deep inside an archive.
- **Tool Caching**: Uses the standard runner tool cache to speed up subsequent runs.
- **Flexible Matching**: Supports literal names, regex patterns, and custom file types.

## Usage

### Simple (Automatic Selection)

The action will automatically detect your OS (Linux, Windows, macOS) and architecture (x64, ARM64) and look for a matching archive. It will search for a binary named after the repository.

```yaml
- name: Install LEGO
  uses: skoszewski/setup-github-release@v1
  with:
    repository: 'go-acme/lego'
```

> **Note:** RClone is an example of a project that provides a binary in a subdirectory inside the archive. The action will find it automatically.

### Advanced Asset Selection

For projects with multiple binary versions, you can use a regex pattern (prefixed with `~`) to narrow down the asset. Hugo is an example where you have to choose between one of the three versions: standard, extended, or extended with deploy support.

```yaml
- name: Install Extended Hugo
  uses: skoszewski/setup-github-release@v1
  with:
    repository: 'gohugoio/hugo'
    file-name: '~hugo_extended_[^a-z]' # Regex to match extended version
```

### Specific Binary Finding

If the binary name is different from the repository name, like in the example of GitHub CLI, you can specify the `binary-name` input to locate the correct executable inside the downloaded asset:

```yaml
- name: Install GitHub CLI
  uses: skoszewski/setup-github-release@v1
  with:
    repository: 'cli/cli'
    binary-name: 'gh' # Searches for 'gh' (or 'gh.exe') inside the extracted release
```

### Debugging Archive Content

If you are unsure how the binary is named, use the `debug` flag to list all files in the unpacked asset, or download the asset manually to inspect its structure.

```yaml
- uses: skoszewski/setup-github-release@v1
  with:
    repository: 'owner/repo'
    debug: true
```

## Inputs / Options

The following inputs are available for the GitHub Action, and as options for the CLI tool:

- `repository` (required): The GitHub repository in the format `owner/repo` from which to download the release.
- `file-name` (optional): The name or the regex pattern (prefixed with `~`) of the asset file to download from the release.
- `binary-name` (optional): The name or regex pattern (prefixed with `~`) of the binary to search for within the downloaded asset. Defaults to the repository name.
- `file-type` (optional, default: 'archive'): The regex pattern to identify the type of the file to be downloaded. There are two predefined keywords:

    - 'archive': matches common archive file extensions like .zip, .tar.gz, .tar, .tgz, .7z.
    - 'package': matches common package file extensions like .deb, .rpm, .pkg.
    - or a custom regex pattern can be provided to match specific file types.

- `install-path` (optional, CLI only): Custom installation directory for the CLI tool.
- `update-cache` (optional, default: 'false', Action only): When set to 'false', the action will use the cached version of the tool if it is already available. If set to 'true', the action will check the latest release and update the cache if a newer version is found. If set to 'always', it will always download and install, updating the cache regardless.
- `debug` (optional, default: 'false'): When set to `true`, the action will log the contents of the unpacked directory to the console.
- `token` (optional): A GitHub token for authentication, useful for accessing private repositories or increasing rate limits.

> **Important:** Default authentication will only work if the action is used within GitHub workflow. For Gitea or the CLI, you must provide a token explicitly (e.g. `GITHUB_TOKEN` environment variable).

## CLI Usage

The `install-github-release` tool follows the same logic as the Action.

```bash
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
```

## GitHub Token Verification

The project includes a utility to verify the validity of your GitHub token.

### CLI Utility

```bash
check-github-token <token>
```

If no token is provided as an argument, it will attempt to read from the `GITHUB_TOKEN` environment variable.

### GitHub Action

You can also use the `check-token` subaction in your workflows:

```yaml
- name: Verify Token
  uses: skoszewski/setup-github-release/check-token@v1
  with:
    repository: 'actions/checkout' # Optional, defaults to actions/checkout
    token: ${{ secrets.MY_TOKEN }}
```

If the `token` input is not provided, it will read from the `GITHUB_TOKEN` environment variable.

## Asset Selection Procedure

The list of assets from the latest release is filtered based on the following rules:

1. If neither `file-name` nor `file-type` is provided, the tool defaults to selecting assets that match the following regular expression: `{{SYSTEM}}[_-]{{ARCH}}.*{{EXT_PATTERN}}$`, where:

    - `{{SYSTEM}}` is replaced with the detected operating system regex.
    - `{{ARCH}}` is replaced with the detected architecture regex.
    - `{{EXT_PATTERN}}` is a regex pattern defined by the `file-type` input (defaulting to 'archive' if not specified).

2. If `file-name` is provided literally, the tool uses it directly to match the asset name by using exact string comparison.

3. If `file-name` is provided as a regex pattern (prefixed with `~`), then:

    - If the pattern does not end with `$` and does not include any placeholders, the tool appends `.*{{SYSTEM}}[_-]{{ARCH}}.*{{EXT_PATTERN}}$` to the provided pattern.
    - If it already ends with `$` or includes all three placeholders, the tool uses it as-is to match the asset name using regex.
    - If only `{{SYSTEM}}` and `{{ARCH}}` placeholders are included, the tool appends `.*{{EXT_PATTERN}}$`.

4. If `file-type` is not equal to 'archive' or 'package', it is treated as a custom regex pattern to match the file extension.

5. The tool applies the constructed regex pattern to filter the assets from the latest release.

6. If multiple assets match the criteria, the tool fails.

7. After download and extraction, the tool recursively searches for the binary specified by `binary-name` (or the repository name). If found, the directory containing the binary is used as the tool directory and added to the PATH (or used for installation). If the binary is not found, the tool fails.

8. `{{SYSTEM}}` is replaced with the detected operating system regex:

    - For Linux: `linux`.
    - For MacOS: `(darwin|macos|mac)`.
    - For Windows: `(windows|win)`.

9. `{{ARCH}}` is replaced with the detected architecture regex:

    - For x64: `(x86_64|x64|amd64)`.
    - For arm64: `(aarch64|arm64)`.

10. All regular expression matches are case-insensitive.

## License

MIT

