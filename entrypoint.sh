#!/bin/bash

# Set constants
WORKDIR="/tmp/repo"

export OPEN_ROUTER_API_KEY=${OPEN_ROUTER_API_KEY}

# Switch to the repo directory

git clone ${REPO_NAME} -b ${BRANCH_NAME} --single-branch ${WORKDIR}

cd "${WORKDIR}"

# Fetch the default branch to ensure it's available for diffing
# The DEFAULT_BRANCH env var is passed from the cloud run job
git fetch origin ${DEFAULT_BRANCH}:${DEFAULT_BRANCH}

# Set git config (For some reason setting this in the Dockerfile doesn't work!)
git config --global user.email "205536373+ai-jr-dev[bot]@users.noreply.github.com"
git config --global user.name "ai-jr-dev[bot]"

# Generate diff file
# Compare the current branch (BRANCH_NAME) against the default branch (DEFAULT_BRANCH)
# Use -C10 for 10 lines of context
git diff -C10 origin/${DEFAULT_BRANCH}..${BRANCH_NAME} > pr-changes.diff

# Run aider command
# Set default values for editor and weak models if not provided
EDITOR_MODEL="${EDITOR_MODEL:-$MODEL}"
WEAK_MODEL="${WEAK_MODEL:-$MODEL}"

# Run aider command with specified models and the diff file
eval "aider --no-show-model-warnings --no-check-update --yes-always --model $MODEL --editor-model $EDITOR_MODEL --weak-model $WEAK_MODEL --read pr-changes.diff --auto-commit --message \"${PROMPT}\""

# Push changes
git push origin $BRANCH_NAME
