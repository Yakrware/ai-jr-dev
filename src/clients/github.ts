import { App, Octokit } from "octokit";
import { WebhookEventMap } from "@octokit/webhooks-types";
import { kebabCase } from "../utilities.js"; // Assuming kebabCase is needed here or passed in

// Type definitions for payloads used in this client
type IssuesLabeledPayload = WebhookEventMap["issues.labeled"];
type PullRequestReviewSubmittedPayload =
  WebhookEventMap["pull_request_review.submitted"];

/**
 * Creates an initial "I'm on it!" comment on an issue.
 */
export async function createWorkingComment(
  octokit: Octokit,
  payload: IssuesLabeledPayload
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: payload.issue.number,
    body: "I'm on it!",
  });
}

/**
 * Gets or creates a branch based on the issue details.
 * Returns the branch name.
 */
export async function ensureBranchExists(
  octokit: Octokit,
  payload: IssuesLabeledPayload
): Promise<string> {
  const branchName = `ai-jr-dev/${payload.issue.number}-${kebabCase(
    payload.issue.title
  )}`;

  try {
    // getBranch raises an error when branch is not found
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
  return branchName;
}

/**
 * Creates a Pull Request for the given branch.
 * Returns the URL of the created PR.
 */
export async function createPullRequest(
  octokit: Octokit,
  payload: IssuesLabeledPayload,
  branchName: string
): Promise<string> {
  const prResponse = await octokit.rest.pulls.create({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    title: `[AI] ${payload.issue.title}`,
    head: branchName,
    base: payload.repository.default_branch,
    // TODO: Add issue reference to PR body
  });
  return prResponse.data.html_url;
}

/**
 * Creates a comment linking to the newly created Pull Request.
 */
export async function createPrLinkedComment(
  octokit: Octokit,
  payload: IssuesLabeledPayload,
  prUrl: string
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: payload.issue.number,
    body: `Pull request created: ${prUrl}`,
  });
}

/**
 * Handles errors during issue processing by creating a comment and removing the label.
 */
export async function handleIssueError(
  octokit: Octokit,
  payload: IssuesLabeledPayload,
  error: any
): Promise<void> {
  console.error("Error processing issue label event:", JSON.stringify(error));
  try {
    await octokit.rest.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      body: "I'm sorry, I've actually had an error that I don't know how to handle. You can try again, but if it keeps failing, I'll have my own Sr dev's review the error.",
    });
    if (payload.label?.name) {
      await octokit.rest.issues.removeLabel({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.issue.number,
        name: payload.label.name,
      });
    }
  } catch (e) {
    console.error("Failed to handle issue error gracefully:", e);
  }
}

/**
 * Re-requests a review on a Pull Request from the user who submitted the review.
 */
export async function requestReviewAgain(
  octokit: Octokit,
  payload: PullRequestReviewSubmittedPayload
): Promise<void> {
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
}
