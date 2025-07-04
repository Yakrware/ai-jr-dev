import { Octokit } from "octokit";
import { WebhookEventDefinition } from "@octokit/webhooks/types";
import { runCloudRunJob } from "../clients/cloudrun.js";
import { generateIssuePrompt } from "../lib/prompt.js";
import {
  checkQuotaAndNotify,
  hasBranchChanged,
  createWorkingComment,
  createPullRequest,
  handleIssueError,
  createBranch,
} from "../clients/github.js";
import { addPullRequestToUsage } from "../clients/mongodb.js";
import { identifyMissingFiles, extractSessionCost } from "../clients/openai.js";
import { WATCHED_LABELS } from "../constants.js";

type IssuesLabeledPayload = WebhookEventDefinition<"issues-labeled">;

export async function handleIssuesLabeled({
  payload,
  octokit,
}: {
  payload: IssuesLabeledPayload;
  octokit: Octokit;
}) {
  if (!payload.installation || !payload.label?.name) return;

  if (WATCHED_LABELS.includes(payload.label.name)) {
    try {
      const owner = payload.repository.owner;
      const installationId = payload.installation.id;

      const installation = await checkQuotaAndNotify(
        octokit,
        payload,
        installationId,
        owner.login
      );

      if (!installation) {
        return; // Stop processing if quota exceeded or error occurred during check
      }

      await createWorkingComment(octokit, payload);

      const branchName = await createBranch(octokit, payload);

      const startBranch = await octokit.rest.repos.getBranch({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        branch: branchName,
      });

      // Generate prompt using the payload directly
      const prompt = generateIssuePrompt(payload);

      const jobParams = {
        installationId: payload.installation.id,
        prompt,
        cloneUrlWithoutToken: payload.repository.clone_url,
        branchName: branchName,
        defaultBranch: payload.repository.default_branch,
      };

      let result = await runCloudRunJob(octokit, jobParams);
      let sessionCost = await extractSessionCost(result);

      const midBranch = await octokit.rest.repos.getBranch({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        branch: branchName,
      });

      if (startBranch.data.commit.sha === midBranch.data.commit.sha) {
        // Analyze the first run's output to see if files were missing
        const files = await identifyMissingFiles(prompt, result);
        result = await runCloudRunJob(octokit, { ...jobParams, files });
        sessionCost += await extractSessionCost(result);
      }

      // Check if changes were made before creating PR
      const endBranch = await octokit.rest.repos.getBranch({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        branch: branchName,
      });

      if (startBranch.data.commit.sha === endBranch.data.commit.sha) {
        throw new Error(
          `Branch ${branchName} still has no changes after all attempts. Aborting PR creation.`
        );
      }

      // create a pull request summary using the job output
      const prResponse = await createPullRequest(
        octokit,
        payload,
        branchName,
        result
      );
      const prNumber = prResponse.data.number;

      // --- Record PR Usage ---
      try {
        await addPullRequestToUsage(
          installationId,
          installation.renewalDate,
          prNumber,
          sessionCost
        );
      } catch (dbError) {
        console.error(`Failed to record usage for PR #${prNumber}:`, dbError);
        // Decide if this failure is critical. Logging might be sufficient.
      }
      // --- End Record PR Usage ---
    } catch (e: any) {
      // Use the centralized error handler
      await handleIssueError(octokit, payload, e);
    }
  }
}
