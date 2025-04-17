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

# Set default values for models if not provided
MODEL="${MODEL:-openrouter/google/gemini-2.5-pro-preview-03-25}"
EDITOR_MODEL="${EDITOR_MODEL:-openrouter/anthropic/claude-3.7-sonnet}"
WEAK_MODEL="${WEAK_MODEL:-openrouter/google/gemini-2.0-flash-001}"

# Build the aider command with model parameters
AIDER_CMD="aider --architect --no-show-model-warnings --no-check-update --yes-always"
AIDER_CMD+=" --model $MODEL"
AIDER_CMD+=" --editor-model $EDITOR_MODEL"
AIDER_CMD+=" --weak-model $WEAK_MODEL"

# Add files if specified
if [ ! -z "$FILES" ]; then
  AIDER_CMD+=" $FILES"
fi

# Add the prompt
AIDER_CMD+=" --message \"${PROMPT}\""

# Run aider command with specified models
eval "$AIDER_CMD"

# Push changes
git push origin $BRANCH_NAME
