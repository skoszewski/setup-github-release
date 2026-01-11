import { parseArgs } from 'util';
import { fetchLatestRelease } from './core/downloader';

async function run() {
  const { positionals } = parseArgs({
    allowPositionals: true
  });

  const token = positionals[0] || process.env.GITHUB_TOKEN;

  if (!token) {
    console.error('Error: No GitHub token provided as an argument or found in GITHUB_TOKEN environment variable.');
    process.exit(1);
  }

  try {
    console.log('Verifying GitHub token...');
    // Attempt to list latest release of actions/checkout as a test
    await fetchLatestRelease('actions/checkout', token);

    console.log('\x1b[32mSuccess: The provided GitHub token is valid and has sufficient permissions to access public repositories.\x1b[0m');
  } catch (error: any) {
    console.error('\x1b[31mError: GitHub token verification failed.\x1b[0m');
    console.error(`Reason: ${error.message}`);
    process.exit(1);
  }
}

run();
