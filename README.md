# setup-github-release

This GitHub/Gitea Action downloads a tool from a GitHub release based on platform-aware selection rules and adds it to the system PATH.

## Usage

### Simple (Automatic Selection)
The action will automatically detect your OS and ARCH and look for a matching archive.
```yaml
- uses: ./
  with:
    repo-name: 'gohugoio/hugo'
```

### Regex Search
You can use a regex pattern (prefixed with `~`) to narrow down the asset.
```yaml
- uses: ./
  with:
    repo-name: 'gohugoio/hugo'
    file-name: '~hugo_extended'
```

### Custom File Type
```yaml
- uses: ./
  with:
    repo-name: 'some/repo'
    file-type: 'package' # Matches .deb, .rpm, .pkg
```

## Inputs

- `repo-name` (required): GitHub repository in `owner/repo` format.
- `file-name` (optional): Literal name or regex pattern (if starts with `~`) to match the asset.
- `file-type` (optional, default: `archive`): Predefined keywords `archive`, `package`, or a custom regex extension pattern.
- `token` (optional): GitHub token for authentication.
