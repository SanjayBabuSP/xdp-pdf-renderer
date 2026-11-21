#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$root/.skills"
target_dir="$root/.agents/skills"

mkdir -p "$target_dir"

for link in "$target_dir"/*; do
  if [ -L "$link" ] && [ ! -e "$link" ]; then
    rm "$link"
  fi
done

for skill_dir in "$source_dir"/*; do
  name="$(basename "$skill_dir")"
  link="$target_dir/$name"
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    echo "skipping non-symlink $link" >&2
    continue
  fi
  ln -sfn "../../.skills/$name" "$link"
done
