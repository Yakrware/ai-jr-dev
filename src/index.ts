import { App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import { ReviewAndComments, reviewAndComments } from "./queries.js";
import { runCloudRunJob } from "./clients/cloudrun.js";
import dotenv from "dotenv";
import { kebabCase } from "./utilities.js";

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

    const title = `${payload.issue.title}`;
    const body = `${payload.issue.body}`;

    const branchName = `ai-jr-dev/${payload.issue.number}-${kebabCase(
      payload.issue.title
    )}`;

    try {
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
      // TODO: clean user input
      const prompt = `Apply all necessary changes based on below issue description. \nIssue title: ${title}\nIssue description:\n${body}`;

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
      console.error("Error processing issue label event:", e); // Log specific error context
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
        const resp = await octokit.graphql<ReviewAndComments>(
          reviewAndComments,
          {
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            pr: payload.pull_request.number,
          }
        );
        const comments = resp.repository.pullRequest.reviews.nodes
          .find((review) => review.id === payload.review.node_id)
          ?.comments.nodes.map((comment, i) => {
            const commentString: string[] = [];
            commentString.push(`${i + 1}. file: ${comment.path}`); // Start numbering at 1
            if (comment.line) {
              commentString.push(
                comment.startLine && comment.startLine !== comment.line
                  ? `lines: ${comment.startLine}-${comment.line}`
                  : `line: ${comment.line}`
              );
            }
            commentString.push(`comment: ${comment.bodyText}`);
            return commentString.join("; ");
          })
          .join("\n");

        let prompt = `Apply all necessary changes based on the following review comments.`;
        if (payload.review.body) {
          prompt += `\n\nOverall review summary:\n${payload.review.body}`;
        }
        if (comments && comments.length > 0) {
          prompt += `\n\nSpecific comments on files:\n${comments}`;
        } else if (!payload.review.body) {
          console.log(
            `Review ${payload.review.id} has no body or comments, skipping job run.`
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

export const webhook = createNodeMiddleware(octoApp.webhooks, { path: "/" });
