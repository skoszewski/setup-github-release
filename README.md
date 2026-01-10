# Setup GitHub Release Action

This GitHub/Gitea Action downloads a release from a specified GitHub repository and adds it to the runners tool cache.

## Usage

```yaml
- uses: ./
  with:
    repo-name: 'owner/repo'
    file-name: 'tool-linux.*'
    use-regex: 'true'
```
