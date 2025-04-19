import { Octokit } from "octokit";
import { WebhookEventDefinition } from "@octokit/webhooks/types";
import { runCloudRunJob } from "../clients/cloudrun.js";
import { generateReviewPrompt } from "../lib/prompt.js";
import {
  resetReviewRequest,
  getInstallationFromOwner,
  handleNoChangesGenerated,
} from "../clients/github.js";
import { addSessionToPullRequest } from "../clients/mongodb.js";
import { identifyMissingFiles, extractSessionCost } from "../clients/openai.js";
import { WATCHED_LABELS, APP_USER_ID } from "../constants.js";

type PullRequestReviewSubmittedPayload =
  WebhookEventDefinition<"pull-request-review-submitted">;

export async function handlePullRequestReviewSubmitted({
  payload,
  octokit,
}: {
  payload: PullRequestReviewSubmittedPayload;
  octokit: Octokit;
}) {
  if (!payload.installation || payload.review.state !== "changes_requested")
    return;

  const installationId = payload.installation.id; // Get installation ID early
  const prNumber = payload.pull_request.number; // Get PR number early

  if (
    payload.pull_request.user?.id === APP_USER_ID ||
    payload.pull_request.labels.some((label) =>
      WATCHED_LABELS.includes(label.name)
    )
  ) {
    try {
      // Generate prompt using the new function, passing octokit and payload
      const prompt = await generateReviewPrompt({ octokit, payload });

      // Check if a prompt was generated (it might be null if no actionable feedback)
      if (!prompt) {
        console.warn(
          `No actionable feedback found in review ${payload.review.id}. Skipping job run.`
        );
        return;
      }

      // Fetch files changed in the pull request
      const { data: prFiles } = await octokit.rest.pulls.listFiles({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        pull_number: payload.pull_request.number,
      });

      // Extract filenames
      let files = prFiles.map((file) => file.filename);
      const startBranch = await octokit.rest.repos.getBranch({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        branch: payload.pull_request.head.ref,
      });

      const jobParams = {
        installationId,
        prompt,
        cloneUrlWithoutToken: payload.repository.clone_url,
        branchName: payload.pull_request.head.ref,
        files,
        defaultBranch: payload.repository.default_branch,
      };
      let result = await runCloudRunJob(octokit, jobParams);
      let sessionCost = await extractSessionCost(result);

      const midBranch = await octokit.rest.repos.getBranch({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        branch: payload.pull_request.head.ref,
      });

      if (startBranch.data.commit.sha === midBranch.data.commit.sha) {
        // first run didn't find anything.
        files = files.concat(await identifyMissingFiles(prompt, result));
        result = await runCloudRunJob(octokit, { ...jobParams, files });
        sessionCost += await extractSessionCost(result);

        const endBranch = await octokit.rest.repos.getBranch({
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          branch: payload.pull_request.head.ref,
        });

        if (startBranch.data.commit.sha === endBranch.data.commit.sha) {
          // Call the function to comment about no changes
          await handleNoChangesGenerated(octokit, payload);
        }
      }

      // --- Record Session Usage ---
      try {
        const installation = await getInstallationFromOwner({
          octokit,
          payload,
        });
        await addSessionToPullRequest(
          installationId,
          installation.renewalDate,
          prNumber,
          sessionCost
        );
      } catch (dbError) {
        console.error(
          `Failed to record review session usage for PR #${prNumber}:`,
          dbError
        );
      }
      // --- End Record Session Usage ---

      // TODO: use image output to make any comments, such as commands that the AI needs the user's help running
      // TODO: clean up - use graphql API to hide all change requests
      // TODO: Mark any floating comments as resolved.
      await resetReviewRequest(octokit, payload);
      // add to the current PR cost
    } catch (e: any) {
      // Consider adding a specific error handler for review events if needed
      console.error("Error processing review submission event:", e);
    }
  }
}
