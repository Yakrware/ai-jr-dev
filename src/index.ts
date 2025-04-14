import { App, Octokit } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import { runCloudRunJob } from "./clients/cloudrun.js";
import dotenv from "dotenv";
import { generateIssuePrompt, generateReviewPrompt } from "./lib/prompt.js";
import * as githubClient from "./clients/github.js";
import { 
  getEnterpriseClient,
  getInstallationUsage,
  addPullRequestToUsage,
  addSessionToPullRequest
} from "./clients/mongodb.js";
import { identifyMissingFiles, extractSessionCost } from "./clients/openai.js";

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
      const owner = payload.repository.owner;
      const installationId = payload.installation.id;
      const issueNumber = payload.issue.number;
      const repoFullName = payload.repository.full_name;

      console.log(`Processing issue #${issueNumber} in ${repoFullName} for label "${payload.label.name}"`);

      // --- Quota Check ---
      const enterprise = await getEnterpriseClient(
        [payload.issue.user?.login, payload.organization?.login].filter(
          isString
        )
      );
      if (!enterprise) {
        console.log(`Account ${owner.login} is not an enterprise client. Checking usage quota.`);

        const subscription = await githubClient.getSubscriptionDetails(octokit, owner.login);

        if (!subscription.isActive) {
          console.warn(`Subscription for ${owner.login} is not active. Applying default limit of ${subscription.monthlyPrLimit}.`);
          // Optionally block inactive subscriptions here if desired
        }

        const renewalDate = new Date(subscription.renewalDate);
        const cycleStartDate = new Date(renewalDate);
        cycleStartDate.setMonth(cycleStartDate.getMonth() - 1); // Calculate start of current cycle

        const usageData = await getInstallationUsage(installationId);
        const prsThisCycle = usageData?.pull_requests.filter(pr => new Date(pr.created_at) >= cycleStartDate) ?? [];
        const currentPrCount = prsThisCycle.length;

        console.log(`Quota check for ${owner.login}: Limit=${subscription.monthlyPrLimit}, Used=${currentPrCount}, CycleStart=${cycleStartDate.toISOString()}`);

        if (currentPrCount >= subscription.monthlyPrLimit) {
          console.warn(`Quota exceeded for ${owner.login} (Installation ID: ${installationId}). Limit: ${subscription.monthlyPrLimit}, Used: ${currentPrCount}.`);
          await githubClient.createQuotaExceededComment(octokit, payload, subscription.renewalDate);
          return; // Stop processing
        }
        console.log(`Quota check passed for ${owner.login}.`);
      }

      await githubClient.createWorkingComment(octokit, payload);
      // --- End Quota Check ---

      const branchName = await githubClient.fetchBranch(octokit, payload);

      // Generate prompt using the payload directly
      const prompt = generateIssuePrompt(payload);

      const jobParams = {
        installationId: payload.installation.id,
        prompt,
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
        // Analyze the first run's output to see if files were missing
        const files = await identifyMissingFiles(prompt, result);

        if (files.length > 0) {
          // Update job params with files for the second run
          const secondRunParams = { ...jobParams, files };
          result = await runCloudRunJob(octokit, secondRunParams);
        } else {
          // If no specific files identified, run the job again with original params
          // Consider if a modified prompt is needed here instead/as well.
          result = await runCloudRunJob(octokit, jobParams);
        }

        // Optional: Check again after the second run
        const changedAfterSecondRun = await githubClient.hasBranchChanged({
          octokit,
          repository: payload.repository,
          branchName: branchName,
        });
      }

      // Check if changes were made before creating PR
      const finalBranchChanged = await githubClient.hasBranchChanged({
        octokit,
        repository: payload.repository,
        branchName: branchName,
      });

      if (!finalBranchChanged) {
        console.warn(`Branch ${branchName} still has no changes after all attempts. Aborting PR creation.`);
        // TODO: Add comment explaining no changes were made and remove label?
        return; // Exit early
      }

      // create a pull request summary using the job output
      const prResponse = await githubClient.createPullRequest(octokit, payload, branchName, result);
      const prNumber = prResponse.data.number;
      console.log(`Pull Request #${prNumber} created for issue #${issueNumber}.`);

      // --- Record PR Usage ---
      try {
        const initialCost = await extractSessionCost(result); // Use final job output
        console.log(`Extracted initial cost for PR #${prNumber}: ${initialCost}`);
        await addPullRequestToUsage(installationId, prNumber, initialCost);
        console.log(`Recorded usage for PR #${prNumber} in installation ${installationId}.`);
      } catch (dbError) {
        console.error(`Failed to record usage for PR #${prNumber}:`, dbError);
        // Decide if this failure is critical. Logging might be sufficient.
      }
      // --- End Record PR Usage ---
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

    const installationId = payload.installation.id; // Get installation ID early
    const prNumber = payload.pull_request.number; // Get PR number early
    const repoFullName = payload.repository.full_name;

    if (
      payload.pull_request.user?.id === Number(process.env.APP_USER_ID) ||
      payload.pull_request.labels.some((label) =>
        WATCHED_LABELS.includes(label.name)
      )
    ) {
      try {
        console.log(`Processing 'changes_requested' review for PR #${prNumber} in ${repoFullName}`);

        // Generate prompt using the new function, passing octokit and payload
        const prompt = await generateReviewPrompt({ octokit, payload });

        // Check if a prompt was generated (it might be null if no actionable feedback)
        if (!prompt) {
          console.log(
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
        const files = prFiles.map((file) => file.filename);

        console.log(`Running Cloud Run job for review feedback on PR #${prNumber}`);
        const result = await runCloudRunJob(octokit, {
          installationId,
          prompt,
          cloneUrlWithoutToken: payload.repository.clone_url,
          branchName: payload.pull_request.head.ref,
          files, // Pass the list of changed files
        });
        console.log(`Cloud Run job for review feedback on PR #${prNumber} completed. Output length: ${result.length}`);

        // --- Record Session Usage ---
        try {
          const sessionCost = await extractSessionCost(result);
          console.log(`Extracted session cost for review on PR #${prNumber}: ${sessionCost}`);
          await addSessionToPullRequest(installationId, prNumber, sessionCost);
          console.log(`Recorded review session usage for PR #${prNumber} in installation ${installationId}.`);
        } catch (dbError) {
          console.error(`Failed to record review session usage for PR #${prNumber}:`, dbError);
        }
        // --- End Record Session Usage ---

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
