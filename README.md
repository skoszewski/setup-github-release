# Setup Tool Action

This GitHub/Gitea Action downloads a tool from a specified URL and adds it to the system PATH.

## Usage

```yaml
- uses: ./
  with:
    tool-url: 'https://example.com/tool.tar.gz'
    tool-name: 'mytool'
    version: '1.0.0'
```

## Developing

1. Install dependencies: `npm install`
2. Build the action: `npm run build`
3. Test locally: (add tests if needed)
