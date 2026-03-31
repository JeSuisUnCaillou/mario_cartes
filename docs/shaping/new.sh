#!/bin/bash
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <version> <name>"
  echo "Example: $0 0.11.1 \"introducing cards\""
  exit 1
fi

version="$1"
name="$2"
title="v$version - ${name^}"
file="$(dirname "$0")/$title.md"

echo "# $title" > "$file"
echo "Created $file"
