import { App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import { ReviewAndComments, reviewAndComments } from "./queries.js";
import { JobsClient } from "@google-cloud/run";
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

const watchedLabels = ["aider", "ai-jr-dev"];

octoApp.webhooks.on("issues.labeled", async ({ payload, octokit }) => {
  if (!payload.installation) return;

  if (payload.label?.name && watchedLabels.includes(payload.label.name)) {
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
      const auth = await octokit.rest.apps.createInstallationAccessToken({
        installation_id: payload.installation.id,
      });
      const prompt = `Apply all necessary changes based on below issue description. \nIssue title: ${title}\nIssue description:\n${body}`;

      const fullJobName = `projects/ai-jr-dev-production/locations/us-central1/jobs/aider-runner`;

      const jobsClient = new JobsClient();
      const [operation] = await jobsClient.runJob({
        name: fullJobName,
        overrides: {
          containerOverrides: [
            {
              env: [
                { name: "AIDER_ARGS", value: `--message "${prompt}"` },
                {
                  name: "REPO_NAME",
                  value: `https://x-access-token:${
                    auth.data.token
                  }@${payload.repository.clone_url.slice(8)}`,
                },
                { name: "BRANCH_NAME", value: branchName },
              ],
            },
          ],
        },
      });
      const [_response] = await operation.promise();
      // TODO: use image output to generate a PR summary, including any commands the user needs to run for the AI
      await octokit.rest.pulls.create({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        title: `[AI] ${payload.issue.title}`,
        head: branchName,
        base: payload.repository.default_branch,
      });
    } catch (e: any) {
      console.error(e);
    }
  }
});

octoApp.webhooks.on(
  "pull_request_review.submitted",
  async ({ payload, octokit }) => {
    if (!payload.installation) return;

    const prLabels = payload.pull_request.labels.map((label) => label.name);

    const watchedLabelsPresent = prLabels.some((label) =>
      watchedLabels.includes(label)
    );

    if (
      payload.pull_request.user?.id || watchedLabelsPresent &&
      payload.review.state === "changes_requested"
    ) {
      const resp = await octokit.graphql<ReviewAndComments>(reviewAndComments, {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        pr: payload.pull_request.number,
      });
      const comments = resp.repository.pullRequest.reviews.nodes
        .find((review) => review.id === payload.review.node_id)
        ?.comments.nodes.map((comment, i) => {
          const commentString: string[] = [];
          commentString.push(`${i}. files: ${comment.path}`);
          if (comment.line) {
            commentString.push(
              comment.startLine
                ? `lines: ${comment.startLine} - ${comment.line}`
                : `line: ${comment.line}`
            );
          }
          commentString.push(comment.bodyText);
          return commentString.join("; ");
        })
        .join("\n");
      // put together new prompt
      const prompt = `Apply all necessary changes based on below issue description. Related to the all files: ${payload.review.body}\nSpecific Files: ${comments}`;
      const auth = await octokit.rest.apps.createInstallationAccessToken({
        installation_id: payload.installation.id,
      });
      // send prompt to aider
      const fullJobName = `projects/ai-jr-dev-production/locations/us-central1/jobs/aider-runner`;
      const jobsClient = new JobsClient();
      const [operation] = await jobsClient.runJob({
        name: fullJobName,
        overrides: {
          containerOverrides: [
            {
              env: [
                { name: "AIDER_ARGS", value: `--message "${prompt}"` },
                {
                  name: "REPO_NAME",
                  value: `https://x-access-token:${
                    auth.data.token
                  }@${payload.repository.clone_url.slice(8)}`,
                },
                { name: "BRANCH_NAME", value: payload.pull_request.head.ref },
              ],
            },
          ],
        },
      });
      const [_response] = await operation.promise();

      // TODO: use image output to make any comments, such as commands that the AI needs the user's help running
      // TODO: clean up - use graphql API to hide all change requests
      // TODO: Mark any floating comments as resolved.
      // reset review
      octokit.rest.pulls.requestReviewers({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        pull_number: payload.pull_request.number,
        reviewers: [payload.review.user?.login || ""],
      });
    }
  }
);

export const webhook = createNodeMiddleware(octoApp.webhooks, { path: "/" });
