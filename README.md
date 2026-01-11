# Setup GitHub Release Action

This GitHub/Gitea Action downloads a tool from a GitHub release, extracts it, automatically finds the executable, and adds it to the system PATH. It supports platform-aware selection, recursive binary search, and tool caching.

## Features

- **Automatic Platform Detection**: Detects OS and Architecture to find the right asset.
- **Recursive Binary Search**: Finds the executable even if it's nested deep inside an archive.
- **Tool Caching**: Uses the standard runner tool cache to speed up subsequent runs.
- **Flexible Matching**: Supports literal names, regex patterns, and custom file types.

## Usage

### Simple (Automatic Selection)

The action will automatically detect your OS (Linux, Windows, macOS) and architecture (x64, ARM64) and look for a matching archive. It will search for a binary named after the repository.

```yaml
- name: Install Hugo
  uses: koszewscy/setup-github-release@v1
  with:
    repository: 'go-acme/lego'
```

> **Note:** RClone is an example of a project that provides a binary in a subdirectory inside the archive. The action will find it automatically.

### Advanced Asset Selection

For projects with multiple binary versions, you can use a regex pattern (prefixed with `~`) to narrow down the asset. Hugo is an example where you have to choose between one of the three versions: standard, extended, or extended with deploy support.

```yaml
- name: Install Extended Hugo
  uses: koszewscy/setup-github-release@v1
  with:
    repository: 'gohugoio/hugo'
    file-name: '~hugo_extended_[^a-z]' # Regex to match extended version
```

### Specific Binary Finding

If the binary name is different from the repository name, like in the example of GitHub CLI, you can specify the `binary-name` input to locate the correct executable inside the downloaded asset:

```yaml
- name: Install GitHub CLI
  uses: koszewscy/setup-github-release@v1
  with:
    repository: 'cli/cli'
    binary-name: 'gh' # Searches for 'gh' (or 'gh.exe') inside the extracted release
```

### Debugging Archive Content

If you are unsure how the binary is named, use the `debug` flag to list all files in the unpacked asset, or download the asset manually to inspect its structure.

```yaml
- uses: koszewscy/setup-github-release@v1
  with:
    repository: 'owner/repo'
    debug: true
```

## Inputs

- `repository` (required): GitHub repository in `owner/repo` format.
- `file-name` (optional): Literal name or regex pattern (if starts with `~`) to match the asset.
- `binary-name` (optional): The name or regex pattern (if starts with `~`) of the binary to find. Defaults to the repository name.
- `file-type` (optional, default: `archive`): Predefined keywords `archive`, `package`, or a custom regex pattern.
- `debug` (optional, default: `false`): Set to `true` to log the contents of the unpacked asset.
- `token` (optional): GitHub token for authentication (defaults to `${{ github.token }}` that is an equivalent of `${{ secrets.GITHUB_TOKEN }}`). Use `${{ secrets.GITEA_TOKEN }}` for Gitea, or create a personal access token.

> **Important:** Default authentication will will only work if the action is used within GitHub workflow. For Gitea, you must provide a token explicitly.