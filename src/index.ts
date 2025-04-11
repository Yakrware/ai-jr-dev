import { App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import { runCloudRunJob } from "./clients/cloudrun.js";
import dotenv from "dotenv";
import { kebabCase } from "./utilities.js";
import { generateIssuePrompt, generateReviewPrompt } from "./lib/prompt.js"; // Import updated functions

dotenv.config();

const octoApp = new App({
  appId: process.env.APP_ID ?? "",
  privateKey: process.env.PRIVATE_KEY ?? "",
  webhooks: {
    secret: process.env.WEBHOOK_SECRET ?? "",
  },
});

const WATCHED_LABELS = ["aider", "ai-jr-dev"];

octoApp.webhooks.on("issues.labeled", async ({ payload, octokit }) => {
  if (!payload.installation) return;

  if (payload.label?.name && WATCHED_LABELS.includes(payload.label?.name)) {
    await octokit.rest.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      body: "I'm on it!",
    });

    const branchName = `ai-jr-dev/${payload.issue.number}-${kebabCase(
      payload.issue.title
    )}`;

    try {
      // getBranch raises an error when branch is not found, so we use a try/catch for flow control
      await octokit.rest.repos.getBranch({
        repo: payload.repository.name,
        owner: payload.repository.owner.login,
        branch: branchName,
      });
    } catch {
      const defaultBranch = await octokit.rest.repos.getBranch({
        repo: payload.repository.name,
        owner: payload.repository.owner.login,
        branch: payload.repository.default_branch,
      });
      await octokit.rest.git.createRef({
        repo: payload.repository.name,
        owner: payload.repository.owner.login,
        sha: defaultBranch.data.commit.sha,
        ref: `refs/heads/${branchName}`,
      });
    }

    try {
      // Generate prompt using the payload directly
      const prompt = generateIssuePrompt(payload);

      const [_response] = await runCloudRunJob(octokit, {
        installationId: payload.installation.id,
        prompt: prompt,
        cloneUrlWithoutToken: payload.repository.clone_url,
        branchName: branchName,
      });
      await octokit.rest.pulls.create({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        title: `[AI] ${payload.issue.title}`,
        head: branchName,
        base: payload.repository.default_branch,
      });
      // TODO: use image output to generate a PR summary, including any commands the user needs to run for the AI
    } catch (e: any) {
      await octokit.rest.issues.createComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.issue.number,
        body: "I'm sorry, I've actually had an error that I don't know how to handle. You can try again, but if it keeps failing, I'll have my own Sr dev's review the error.",
      });
      await octokit.rest.issues.removeLabel({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.issue.number,
        name: payload.label?.name,
      });
      console.error("Error processing issue label event:", JSON.stringify(e)); // Log specific error context
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

        const [_response] = await runCloudRunJob(octokit, {
          installationId: payload.installation.id,
          prompt: prompt,
          cloneUrlWithoutToken: payload.repository.clone_url,
          branchName: payload.pull_request.head.ref,
        });

        // TODO: use image output to make any comments, such as commands that the AI needs the user's help running
        // TODO: clean up - use graphql API to hide all change requests
        // TODO: Mark any floating comments as resolved.

        // Reset review request
        if (payload.review.user?.login) {
          await octokit.rest.pulls.requestReviewers({
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            pull_number: payload.pull_request.number,
            reviewers: [payload.review.user.login],
          });
        } else {
          console.warn(
            `Could not re-request review for PR #${payload.pull_request.number} as reviewer login is missing.`
          );
        }
      } catch (e: any) {
        console.error("Error processing review submission event:", e); // Log specific error context
      }
    }
  }
);

// TODO: Reference Issue when opening PR
// TODO: If an ai PR is merged, close issue that spawned it.

export const webhook = createNodeMiddleware(octoApp.webhooks, { path: "/" });
