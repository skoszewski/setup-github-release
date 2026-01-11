import * as core from '@actions/core';
import { fetchLatestRelease } from './core/downloader';

async function run() {
  try {
    const repository = core.getInput('repository') || 'actions/checkout';
    const token = core.getInput('token') || process.env.GITHUB_TOKEN;

    if (!token) {
      core.setFailed('No GitHub token provided as an input or found in GITHUB_TOKEN environment variable.');
      return;
    }

    core.info(`Verifying GitHub token using repository ${repository}...`);
    // Attempt to list latest release of the specified repository as a test
    await fetchLatestRelease(repository, token);

    core.info('Success: The provided GitHub token is valid and has sufficient permissions to access the repository.');
  } catch (error: any) {
    core.setFailed(`GitHub token verification failed. Reason: ${error.message}`);
  }
}

run();
