#!/bin/bash

# Set constants
WORKDIR="/tmp/repo"

# Ensure OPEN_ROUTER_API_KEY is available to aider
if [ -n "${OPEN_ROUTER_API_KEY}" ]; then
  export OPEN_ROUTER_API_KEY="${OPEN_ROUTER_API_KEY}"
else
  echo "Warning: OPEN_ROUTER_API_KEY is not set"
fi

# Switch to the repo directory
git clone ${REPO_NAME} -b ${BRANCH_NAME} --single-branch ${WORKDIR}

cp .aider.model.settings.yml ${WORKDIR}/.aider.model.settings.yml
cd "${WORKDIR}"

# Set git config (For some reason setting this in the Dockerfile doesn't work!)
git config --global user.email "205536373+ai-jr-dev[bot]@users.noreply.github.com"
git config --global user.name "ai-jr-dev[bot]"

# Run aider command
# Set default values for editor and weak models if not provided
EDITOR_MODEL="${EDITOR_MODEL:-$MODEL}"
WEAK_MODEL="${WEAK_MODEL:-$MODEL}"

# Generate diff of changes compared to the default branch
git diff -C10 $DEFAULT_BRANCH..$BRANCH_NAME > pr-changes.diff

# Run aider command with specified models
eval "aider --architect --no-show-model-warnings --no-check-update --yes-always --model $MODEL ${FILES} --read pr-changes.diff --message \"${PROMPT}\""

# Push changes
git push origin $BRANCH_NAME
