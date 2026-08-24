#!/usr/bin/env python3

import argparse
import os
import sys

from install_github_release import fetch_latest_release


def main():
    """Parse command-line arguments and verify a GitHub token, reporting errors via the exit code."""
    parser = argparse.ArgumentParser(
        usage='%(prog)s [token]',
        allow_abbrev=False,
    )
    parser.add_argument('token', nargs='?', help='The GitHub token to verify')
    args = parser.parse_args()

    token = args.token or os.environ.get('GITHUB_TOKEN')
    if not token:
        print('Error: No GitHub token provided as an argument or found in GITHUB_TOKEN environment variable.', file=sys.stderr)
        sys.exit(1)

    print('Verifying GitHub token...')
    try:
        fetch_latest_release('actions/checkout', token)
        print('\x1b[32mSuccess: The provided GitHub token is valid and has sufficient permissions to access public repositories.\x1b[0m')
    except Exception as error:
        print('\x1b[31mError: GitHub token verification failed.\x1b[0m', file=sys.stderr)
        print(f'Reason: {error}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
