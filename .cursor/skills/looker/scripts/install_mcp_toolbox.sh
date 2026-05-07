#!/usr/bin/env bash
# Download the Google MCP Toolbox for Databases binary into <repo-root>/bin/toolbox.
# The toolbox powers the Looker MCP wrapper
# (.cursor/skills/looker/scripts/mcp_looker.sh) via the --prebuilt looker config.
# (The ClickHouse MCP wrapper uses uvx + mcp-clickhouse instead, not the toolbox.)
#
# Re-run this to upgrade. The bin/ directory is gitignored.

set -euo pipefail

VERSION="${MCP_TOOLBOX_VERSION:-1.0.0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DEST_DIR="${REPO_ROOT}/bin"
DEST="${DEST_DIR}/toolbox"

OS_RAW="$(uname -s)"
ARCH_RAW="$(uname -m)"

case "${OS_RAW}" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) echo "install_mcp_toolbox: unsupported OS ${OS_RAW}" >&2; exit 1 ;;
esac

case "${ARCH_RAW}" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=amd64 ;;
  *) echo "install_mcp_toolbox: unsupported arch ${ARCH_RAW}" >&2; exit 1 ;;
esac

URL="https://storage.googleapis.com/genai-toolbox/v${VERSION}/${OS}/${ARCH}/toolbox"

mkdir -p "${DEST_DIR}"
echo "install_mcp_toolbox: downloading ${URL}"
curl -fsSL -o "${DEST}" "${URL}"
chmod +x "${DEST}"

"${DEST}" --version
echo "install_mcp_toolbox: installed at ${DEST}"
