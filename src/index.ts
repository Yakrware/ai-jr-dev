import { App, Octokit } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import { runCloudRunJob } from "./clients/cloudrun.js";
import dotenv from "dotenv";
import { generateIssuePrompt, generateReviewPrompt } from "./lib/prompt.js";
import * as githubClient from "./clients/github.js"; // Import the new GitHub client
import { getEnterpriseClient } from "./clients/mongodb.js";

dotenv.config();

const octoApp = new App({
  appId: process.env.APP_ID ?? "",
  privateKey: process.env.PRIVATE_KEY ?? "",
  webhooks: {
    secret: process.env.WEBHOOK_SECRET ?? "",
  },
});

const isString = (item: string | undefined): item is string => {
  return !!item;
};

const WATCHED_LABELS = ["aider", "ai-jr-dev"];

octoApp.webhooks.on("issues.labeled", async ({ payload, octokit }) => {
  if (!payload.installation || !payload.label?.name) return;

  if (WATCHED_LABELS.includes(payload.label.name)) {
    try {
      const enterprise = await getEnterpriseClient(
        [payload.issue.user?.login, payload.organization?.login].filter(
          isString
        )
      );
      if (!enterprise) {
        // TODO: check for active subscription
        // TODO: check for available PR count
        return; // no subscription, no enterprise, don't do anything
      }

      await githubClient.createWorkingComment(octokit, payload);

      const branchName = await githubClient.fetchBranch(octokit, payload);

      // Generate prompt using the payload directly
      const prompt = generateIssuePrompt(payload);

      const jobParams = {
        installationId: payload.installation.id,
        prompt: prompt,
        cloneUrlWithoutToken: payload.repository.clone_url,
        branchName: branchName,
      };

      let result = await runCloudRunJob(octokit, jobParams);

      // Check if the job made any commits
      const changed = await githubClient.hasBranchChanged({
        octokit,
        repository: payload.repository,
        branchName: branchName,
      });

      if (!changed) {
        // If no changes, run the job again
        // TODO: Consider adding logic here to modify the prompt for the second run,
        // e.g., asking the AI why it didn't make changes or providing more context.
        result = await runCloudRunJob(octokit, jobParams);

        // Optional: Check again after the second run, though we proceed to PR creation regardless
        const changedAfterSecondRun = await githubClient.hasBranchChanged({
          octokit,
          repository: payload.repository,
          branchName: branchName,
        });
      }

      // decide if the job did what it was meant to.
      // if there's no commit, see if it's asked for any files
      // try again with missing files

      // create a pull request summary
      // parse out price total
      // save PR and cost on installation
      await githubClient.createPullRequest(octokit, payload, branchName);
    } catch (e: any) {
      // Use the centralized error handler
      await githubClient.handleIssueError(octokit, payload, e);
    }
  }
});

octoApp.webhooks.on(
  "pull_request_review.submitted",
  async ({ payload, octokit }) => {
    if (!payload.installation || payload.review.state !== "changes_requested")
      return;

    if (
      payload.pull_request.user?.id === Number(process.env.APP_USER_ID) ||
      payload.pull_request.labels.some((label) =>
        WATCHED_LABELS.includes(label.name)
      )
    ) {
      try {
        // Generate prompt using the new function, passing octokit and payload
        const prompt = await generateReviewPrompt({ octokit, payload });

        // Check if a prompt was generated (it might be null if no actionable feedback)
        if (!prompt) {
          console.log(
            `No actionable feedback found in review ${payload.review.id}. Skipping job run.`
          );
          return;
        }

        const result = await runCloudRunJob(octokit, {
          installationId: payload.installation.id,
          prompt: prompt,
          cloneUrlWithoutToken: payload.repository.clone_url,
          branchName: payload.pull_request.head.ref,
        });

        // TODO: use image output to make any comments, such as commands that the AI needs the user's help running
        // TODO: clean up - use graphql API to hide all change requests
        // TODO: Mark any floating comments as resolved.

        await githubClient.resetReviewRequest(octokit, payload);
        // add to the current PR cost
      } catch (e: any) {
        // Consider adding a specific error handler for review events if needed
        console.error("Error processing review submission event:", e);
      }
    }
  }
);

octoApp.webhooks.on("pull_request.closed", async ({ payload, octokit }) => {
  if (!payload.installation) return;

  // Check if the PR was merged and (created by our app OR has a watched label)
  const isAppPr =
    payload.pull_request.user?.id === Number(process.env.APP_USER_ID);
  const hasWatchedLabel = payload.pull_request.labels.some((label) =>
    WATCHED_LABELS.includes(label.name)
  );

  if (payload.pull_request.merged && (isAppPr || hasWatchedLabel)) {
    try {
      await githubClient.closeIssueForMergedPr(octokit, payload);
    } catch (e: any) {
      console.error("Error processing PR closed event:", e);
      // Potentially add error handling comment on the PR or related issue if the client function didn't handle it
    }
  }
});

export const webhook = createNodeMiddleware(octoApp.webhooks, { path: "/" });
