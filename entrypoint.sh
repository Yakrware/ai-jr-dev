#!/bin/bash

# Set constants
WORKDIR="/tmp/repo"

export OPEN_ROUTER_API_KEY=${OPEN_ROUTER_API_KEY}

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

# Run aider command with specified models
eval "aider --no-show-model-warnings --no-check-update --yes-always --model $MODEL --message \"${PROMPT}\""

# Push changes
git push origin $BRANCH_NAME