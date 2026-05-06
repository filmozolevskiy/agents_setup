#!/usr/bin/env bash
# Download the Google MCP Toolbox for Databases binary into ./bin/toolbox.
# The toolbox powers both the Looker and ClickHouse MCP wrappers
# (scripts/mcp_looker.sh and scripts/mcp_clickhouse.sh) via --prebuilt configs.
#
# Re-run this to upgrade. The bin/ directory is gitignored.

set -euo pipefail

VERSION="${MCP_TOOLBOX_VERSION:-1.0.0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
