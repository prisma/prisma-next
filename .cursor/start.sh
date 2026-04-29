#!/usr/bin/env bash
# Cursor cloud-agent startup script.
#
# Runs on every VM boot before the agent begins work. Use it for per-boot setup
# that should not be cached into the snapshot (the `install` command is what
# gets cached; `start` runs fresh every time).
#
# Configure the boot-time git identity from Cursor secrets when present.
# Set GIT_USER_NAME and GIT_USER_EMAIL in the Cursor Settings → Secrets tab
# (per-user or team-wide) to attribute this VM's commits to your identity.
# When the secrets are absent (e.g. another team member booted this image
# without setting them up), this block is a no-op and the agent uses whatever
# default git identity the base image / wrapper provides.

set -euo pipefail

if [ -n "${GIT_USER_NAME:-}" ]; then
	git config --global user.name "$GIT_USER_NAME"
fi

if [ -n "${GIT_USER_EMAIL:-}" ]; then
	git config --global user.email "$GIT_USER_EMAIL"
fi
