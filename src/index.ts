import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';
import * as path from 'path';

async function run() {
  try {
    const toolUrl = core.getInput('tool-url', { required: true });
    const toolName = core.getInput('tool-name', { required: true });
    const version = core.getInput('version') || 'latest';

    core.info(`Downloading ${toolName} from ${toolUrl}...`);

    // Download the tool
    const downloadPath = await tc.downloadTool(toolUrl);
    core.info(`Downloaded to ${downloadPath}`);

    // If it's an archive, we might need to extract it. 
    // For simplicity, let's assume it's just a binary for now, 
    // or we can add extraction logic if the URL ends in .tar.gz, .zip etc.
    let toolDir: string;
    if (toolUrl.endsWith('.tar.gz')) {
      toolDir = await tc.extractTar(downloadPath);
    } else if (toolUrl.endsWith('.zip')) {
      toolDir = await tc.extractZip(downloadPath);
    } else {
      // Treat as a direct binary download
      // We might need to make it executable and put it in a directory
      toolDir = path.dirname(downloadPath);
      // Optional: rename if needed, but downloadTool usually gives a random name
    }

    core.info(`Tool extracted/located at ${toolDir}`);

    // Add to path
    core.addPath(toolDir);
    core.info(`Added ${toolDir} to PATH`);

    // In a real scenario, we'd use tc.cacheDir to cache it for future runs
    // cachedPath = await tc.cacheDir(toolDir, toolName, version);
    // core.addPath(cachedPath);

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
