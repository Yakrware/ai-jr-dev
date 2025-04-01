#!/bin/bash

# Set constants
WORKDIR="/tmp/repo"

# Get env vars
BRANCH_NAME=$(echo $FEATURE_REF | sed 's/refs\/heads\///g')

export $API_KEY_ENV_NAME=$API_KEY_ENV_VALUE

# Switch to the repo directory
cd "${WORKDIR}"

git clone $REPO_NAME -b $BRANCH_NAME --single-branch /your/folder

# Fix repo ownership issues
git config --global --add safe.directory "${WORKDIR}"

# Set git config (For some reason setting this in the Dockerfile doesn't work!)
git config --global user.email "205536373+ai-jr-dev[bot]@users.noreply.github.com"
git config --global user.name "ai-jr-dev[bot]"

# Checkout feature branch
git fetch
git checkout $BRANCH_NAME

# Run aider command
# Set default values for editor and weak models if not provided
EDITOR_MODEL="${EDITOR_MODEL:-$MODEL}"
WEAK_MODEL="${WEAK_MODEL:-$MODEL}"

# Run aider command with specified models
eval "aider --model $MODEL --editor-model $EDITOR_MODEL --weak-model $WEAK_MODEL $AIDER_ARGS"

# Push changes
git push -u origin $BRANCH_NAME