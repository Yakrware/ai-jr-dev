import { Octokit } from "octokit";
import { WebhookEventDefinition } from "@octokit/webhooks/types";
import { kebabCase } from "../utilities.js";

// Type definitions for payloads used in this client
type IssuesLabeledPayload = WebhookEventDefinition<"issues-labeled">;
type PullRequestReviewSubmittedPayload =
  WebhookEventDefinition<"pull-request-review-submitted">;

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
 * Fetches or creates a branch based on the issue details.
 * Returns the branch name.
 */
export async function fetchBranch(
  octokit: Octokit,
  payload: IssuesLabeledPayload
): Promise<string> {
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
  return branchName;
}

/**
 * Creates a Pull Request for the given branch and comments on the issue.
 * Returns the full PR response object.
 */
export async function createPullRequest(
  octokit: Octokit,
  payload: IssuesLabeledPayload,
  branchName: string
) {
  const prResponse = await octokit.rest.pulls.create({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    title: `[AI] ${payload.issue.title}`,
    head: branchName,
    base: payload.repository.default_branch,
    // TODO: Add issue reference to PR body
  });

  // Call createPrLinkedComment internally
  await createPrLinkedComment(octokit, payload, prResponse.data.html_url);

  return prResponse; // Return the full response object
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
 * Resets the review request status on a Pull Request, typically asking the original reviewer again.
 */
export async function resetReviewRequest(
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
