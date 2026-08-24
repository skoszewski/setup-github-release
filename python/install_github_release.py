#!/usr/bin/env python3

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

SYSTEM_PATTERNS = {
    'linux': 'linux',
    'darwin': '(darwin|macos|mac|osx)',
    'win32': '(windows|win)',
}

ARCH_PATTERNS = {
    'x64': '(x86_64|x64|amd64|universal)',
    'arm64': '(aarch64|arm64|universal)',
}

MACHINE_TO_ARCH = {
    'x86_64': 'x64',
    'amd64': 'x64',
    'aarch64': 'arm64',
    'arm64': 'arm64',
}

KNOWN_FILE_TYPES = {
    'archive': ('.zip', '.tar.gz', '.tgz'),
    'package': ('.deb', '.pkg', '.rpm'),
    'linux': ('.deb', '.rpm'),
    'macos': ('.pkg',),
    'targz': ('.tgz', '.tar.gz'),
}


class PlatformInfo:
    """Holds the detected OS/architecture and their regex patterns for asset matching."""

    def __init__(self, system, arch):
        self.system = system
        self.arch = arch
        self.system_pattern = SYSTEM_PATTERNS.get(system, system)
        self.arch_pattern = ARCH_PATTERNS.get(arch, arch)


def replace_platform_placeholders(pattern, platform):
    """Substitute {{SYSTEM}} and {{ARCH}} in a pattern with the platform's regex fragments."""
    return pattern.replace('{{SYSTEM}}', platform.system_pattern).replace('{{ARCH}}', platform.arch_pattern)


def get_github_api_headers(token=None):
    """Build the request headers for the GitHub REST API, adding an Authorization header if a token is given."""
    headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'install-github-release-cli',
    }
    if token:
        headers['Authorization'] = f'token {token}'
    return headers


def fetch_latest_release(repository, token=None):
    """Fetch and parse the latest release metadata for a GitHub repository."""
    url = f'https://api.github.com/repos/{repository}/releases/latest'
    request = urllib.request.Request(url, headers=get_github_api_headers(token))
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        body = error.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'Failed to fetch latest release for {repository}: {error.reason}. {body}') from error


def download_asset(url, dest_path, token=None):
    """Download a release asset from url and write it to dest_path."""
    headers = {'User-Agent': 'install-github-release-cli'}
    if token:
        headers['Authorization'] = f'token {token}'
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request) as response, open(dest_path, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Failed to download asset: {error.reason}') from error


def validate_output_directory(output_directory):
    """Resolve output_directory to an absolute path and confirm it already exists."""
    resolved = Path(output_directory).resolve()
    if not resolved.is_dir():
        raise RuntimeError(f'Output directory "{resolved}" does not exist.')
    return str(resolved)


def install_github_release(repository, *, list_only=False, app_name=None, file_name=None, binary_name=None,
                            file_type=None, install_path=None, output_directory=None, releases_json=False,
                            system=None, arch=None, token=None, debug=False, dry_run=False):
    """Download, extract, and install a binary from a repository's latest GitHub release."""

    # Normalize and validate the file-type selector.
    raw_file_type = file_type
    file_type = raw_file_type.strip() if raw_file_type is not None else None
    if raw_file_type is not None and not file_type:
        raise RuntimeError(f'Unknown asset type: {raw_file_type}')

    # List mode: print and return the release's assets without downloading anything.
    if list_only:
        release = fetch_latest_release(repository, token)
        for asset in release['assets']:
            print(f"- {asset['browser_download_url']}")
        return release['assets']

    # Derive the display name and the binary's source/destination names from the repository or overrides.
    tool_name = repository.split('/')[-1] or repository
    app_name = app_name or (tool_name[0].upper() + tool_name[1:] if tool_name else tool_name)

    binary_option = binary_name or tool_name
    binary_parts = binary_option.split(':')
    if len(binary_parts) > 1:
        binary_source, binary_destination = binary_parts[0], binary_parts[1]
    else:
        binary_source = binary_destination = binary_option

    # Releases-JSON mode: save the raw release API response to a file and return its path.
    if releases_json:
        url = f'https://api.github.com/repos/{repository}/releases/latest'
        request = urllib.request.Request(url, headers=get_github_api_headers(token))
        try:
            with urllib.request.urlopen(request) as response:
                raw_release = response.read().decode('utf-8')
        except urllib.error.HTTPError as error:
            body = error.read().decode('utf-8', errors='replace')
            raise RuntimeError(f'Failed to fetch latest release for {repository}: {error.reason}. {body}') from error

        output_base = binary_destination or tool_name
        output_name = f'{output_base}.releases.json'
        if output_directory:
            output_path = os.path.join(validate_output_directory(output_directory), output_name)
        else:
            output_path = output_name
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(raw_release)
        print(f'Downloaded GitHub releases to {output_path}.')
        return output_path

    # Detect (or apply overrides for) the target OS and architecture.
    system = (system or sys.platform).lower()
    raw_machine = arch or (os.uname().machine if hasattr(os, 'uname') else os.environ.get('PROCESSOR_ARCHITECTURE', ''))
    machine = raw_machine.lower()
    arch = MACHINE_TO_ARCH.get(machine, machine)
    platform_info = PlatformInfo(system, arch)

    # Fetch the latest release and select the one asset matching the file-name/file-type criteria.
    print(f'Fetching latest release for {repository}...')
    release = fetch_latest_release(repository, token)
    assets = release['assets']

    # A literal (non-regex) file-name is matched verbatim, bypassing file-type filtering entirely.
    if file_name and not file_name.startswith('~'):
        exact_matches = [a for a in assets if a['name'] == file_name]
        if len(exact_matches) != 1:
            raise RuntimeError(f'Expected exactly one asset to match the provided filename, matched: {len(exact_matches)}')
        asset = exact_matches[0]
    else:
        # Narrow the candidates by file-type: a known type keyword, a trailing regex, or a plain extension.
        file_type_filtered = assets
        if file_type:
            if file_type in KNOWN_FILE_TYPES:
                suffixes = KNOWN_FILE_TYPES[file_type]
                file_type_filtered = [a for a in assets if a['name'].lower().endswith(suffixes)]
            elif file_type.startswith('~'):
                type_regex = re.compile(file_type[1:] + '$', re.IGNORECASE)
                file_type_filtered = [a for a in assets if type_regex.search(a['name'])]
            else:
                extension = file_type.lstrip('.')
                file_type_filtered = [a for a in assets if a['name'].lower().endswith(f'.{extension}'.lower())]

        # A regex file-name (with platform placeholders expanded) is matched against the type-filtered candidates.
        if file_name and file_name.startswith('~'):
            name_pattern = replace_platform_placeholders(file_name[1:], platform_info)
            name_regex = re.compile(name_pattern, re.IGNORECASE)
            matched = [a for a in file_type_filtered if name_regex.search(a['name'])]
            if len(matched) != 1:
                raise RuntimeError(f'Expected exactly one asset to match the filename regex, matched: {len(matched)}')
            asset = matched[0]
        else:
            # With no file-name given, fall back to matching the detected system and architecture.
            default_pattern = replace_platform_placeholders('{{SYSTEM}}[_-]{{ARCH}}', platform_info)
            default_regex = re.compile(default_pattern, re.IGNORECASE)
            matched = [a for a in file_type_filtered if default_regex.search(a['name'])]
            if len(matched) != 1:
                if len(matched) == 0:
                    raise RuntimeError(f'No assets matched the default criteria: {default_pattern}')
                names = ', '.join(a['name'] for a in matched)
                raise RuntimeError(f'Multiple assets matched the default criteria: {names}')
            asset = matched[0]

    version = re.sub(r'^v', '', release['tag_name'], flags=re.IGNORECASE)
    download_url = asset['browser_download_url']
    print(f"Will download '{app_name}' version: {version}")
    print(f'Download URL: "{download_url}".')

    # Dry-run mode: stop after reporting the selected asset.
    if dry_run:
        return {'version': version, 'download_url': download_url, 'asset': asset}

    # Output-directory mode: download the asset without extracting or installing it.
    if output_directory:
        output_dir = validate_output_directory(output_directory)
        output_path = os.path.join(output_dir, os.path.basename(download_url))
        print(f"Downloading '{app_name}' version {version} to '{output_path}'...")
        download_asset(download_url, output_path, token)
        return output_path

    # Full install: download the asset into a temporary directory that is removed on exit.
    temp_dir = tempfile.mkdtemp(prefix='setup-gh-release-')
    try:
        download_path = os.path.join(temp_dir, asset['name'])
        download_asset(download_url, download_path, token)
        asset_name_lower = asset['name'].lower()

        # System-package asset: hand it to the OS package manager and stop, no binary search or copy needed.
        if re.search(r'\.(deb|pkg|rpm)$', asset_name_lower):
            if asset_name_lower.endswith('.deb'):
                pkg_binary, pkg_args = 'dpkg', ['-i', download_path]
            elif asset_name_lower.endswith('.pkg'):
                pkg_binary, pkg_args = 'installer', ['-pkg', download_path, '-target', '/']
            else:
                pkg_binary, pkg_args = 'rpm', ['-i', download_path]

            is_root = hasattr(os, 'getuid') and os.getuid() == 0
            command = [pkg_binary, *pkg_args] if is_root else ['sudo', pkg_binary, *pkg_args]
            result = subprocess.run(command)
            if result.returncode != 0:
                raise RuntimeError(f'Failed to install package using {" ".join(command)}.')

            print('Installation successful!')
            return None

        # Archive asset: extract it into a subdirectory using the format implied by its extension.
        extract_dir = os.path.join(temp_dir, 'extract')
        print(f"Extracting {asset['name']}...")
        os.makedirs(extract_dir, exist_ok=True)

        if asset_name_lower.endswith('.tar.gz') or asset_name_lower.endswith('.tgz') or asset_name_lower.endswith('.tar'):
            with tarfile.open(download_path, 'r:*') as archive:
                archive.extractall(extract_dir, filter='data')
        elif asset_name_lower.endswith('.zip'):
            with zipfile.ZipFile(download_path) as archive:
                archive.extractall(extract_dir)
        elif asset_name_lower.endswith('.7z'):
            result = subprocess.run(['7z', 'x', download_path, f'-o{extract_dir}', '-y'])
            if result.returncode != 0:
                raise RuntimeError('7z failed. Make sure 7z is installed.')
        else:
            shutil.copy2(download_path, os.path.join(extract_dir, os.path.basename(download_path)))

        # Build the binary's search pattern, expanding platform placeholders in a regex or literal name.
        if binary_source.startswith('~'):
            binary_regex_source = replace_platform_placeholders(binary_source[1:], platform_info)
            binary_pattern = f'~{binary_regex_source}'
        else:
            binary_pattern = binary_source.replace('{{SYSTEM}}', platform_info.system).replace('{{ARCH}}', platform_info.arch)

        binary_regex = re.compile(binary_pattern[1:], re.IGNORECASE) if binary_pattern.startswith('~') else None

        # Walk the extracted tree in sorted order and stop at the first file matching the pattern.
        binary_path = None
        for dirpath, dirnames, filenames in os.walk(extract_dir):
            dirnames.sort()
            filenames.sort()
            if debug:
                print(f'Searching for binary in {dirpath}...')
                for item in dirnames + filenames:
                    print(f' - {item}')

            for item in filenames:
                if binary_regex:
                    is_match = bool(binary_regex.search(item))
                else:
                    is_match = item == binary_pattern
                    if not is_match and sys.platform == 'win32' and not binary_pattern.lower().endswith('.exe'):
                        is_match = item.lower() == f'{binary_pattern.lower()}.exe'
                if is_match:
                    binary_path = os.path.join(dirpath, item)
                    break
            if binary_path:
                break

        if not binary_path:
            raise RuntimeError(f'Could not find binary "{binary_source}" in the extracted asset.')

        # Resolve the install directory: an explicit override, or an OS-appropriate default.
        if install_path:
            install_dir = str(Path(install_path).resolve())
        elif sys.platform == 'win32':
            local_app_data = os.environ.get('LOCALAPPDATA') or str(Path.home() / 'AppData' / 'Local')
            install_dir = os.path.join(local_app_data, 'bin')
        elif hasattr(os, 'getuid') and os.getuid() == 0:
            install_dir = '/usr/local/bin'
        else:
            home_bin = str(Path.home() / 'bin')
            install_dir = home_bin if os.path.isdir(home_bin) else '/usr/local/bin'

        os.makedirs(install_dir, exist_ok=True)

        # Copy the binary into place and make it executable.
        final_name = binary_destination or os.path.basename(binary_path)
        dest_path = os.path.join(install_dir, final_name)

        print(f'Installing {final_name} to {dest_path}...')
        shutil.copy2(binary_path, dest_path)
        if sys.platform != 'win32':
            os.chmod(dest_path, 0o755)

        print('Installation successful!')
        return dest_path
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def main():
    """Parse command-line arguments and run install_github_release, reporting errors via the exit code."""
    parser = argparse.ArgumentParser(
        prog='install-github-release',
        usage='%(prog)s [options] <repository>',
        allow_abbrev=False,
    )
    parser.add_argument('repository', nargs='?', help='The GitHub repository (owner/repo)')
    parser.add_argument('--dry-run', action='store_true', help='Run in test mode')
    parser.add_argument('-l', '--list', nargs='?', const=True, default=None, metavar='repository',
                         help='List available assets from latest release and exit')
    parser.add_argument('-a', '--app-name', metavar='name', help='Application name (optional, for output messages)')
    parser.add_argument('-f', '--file-name', metavar='name', help='Asset file name or regex pattern (prefixed with ~)')
    parser.add_argument('-b', '--binary-name', metavar='name', help='Binary name (supports source:destination form)')
    parser.add_argument('-t', '--file-type', metavar='type',
                         help='Known: archive|package|linux|macos|targz; custom: ~<regex> or extension')
    parser.add_argument('-p', '--install-path', metavar='path', help='Custom installation directory')
    parser.add_argument('-o', '--output-directory', metavar='path',
                         help='Only download selected asset to the specified directory')
    parser.add_argument('-j', '--releases-json', action='store_true', help='Download latest release JSON only')
    parser.add_argument('--system', metavar='name', help='Override detected system for asset matching')
    parser.add_argument('--arch', metavar='name', help='Override detected architecture for asset matching')
    parser.add_argument('-k', '--token', metavar='token', help='GitHub token')
    parser.add_argument('-d', '--debug', action='store_true', help='Enable debug logging')
    args = parser.parse_args()

    list_repo = args.list if isinstance(args.list, str) else None
    repository = list_repo or args.repository
    if not repository:
        parser.print_help()
        sys.exit(1)

    try:
        install_github_release(
            repository,
            list_only=args.list is not None,
            app_name=args.app_name,
            file_name=args.file_name,
            binary_name=args.binary_name,
            file_type=args.file_type,
            install_path=args.install_path,
            output_directory=args.output_directory,
            releases_json=args.releases_json,
            system=args.system,
            arch=args.arch,
            token=args.token,
            debug=args.debug,
            dry_run=args.dry_run,
        )
    except Exception as error:
        print(f'Error: {error}', file=sys.stderr)
        sys.exit(1)

    sys.exit(0)


if __name__ == '__main__':
    main()
