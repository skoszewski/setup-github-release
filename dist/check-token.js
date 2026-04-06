#!/usr/bin/env node
"use strict";

// src/check-token.ts
var import_util = require("util");

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

// src/check-token.ts
async function run() {
  const { positionals } = (0, import_util.parseArgs)({
    allowPositionals: true
  });
  const token = positionals[0] || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Error: No GitHub token provided as an argument or found in GITHUB_TOKEN environment variable.");
    process.exit(1);
  }
  try {
    console.log("Verifying GitHub token...");
    await fetchLatestRelease("actions/checkout", token);
    console.log("\x1B[32mSuccess: The provided GitHub token is valid and has sufficient permissions to access public repositories.\x1B[0m");
  } catch (error) {
    console.error("\x1B[31mError: GitHub token verification failed.\x1B[0m");
    console.error(`Reason: ${error.message}`);
    process.exit(1);
  }
}
run();
