import { Octokit } from "octokit";
import {
  WebhookPayloadIssuesLabeled,
  WebhookPayloadPullRequestReviewSubmitted,
} from "@octokit/webhooks-types";
import { ReviewAndComments, reviewAndComments } from "../queries.js"; // Import GraphQL query

// System prompt to guide the AI
const SYSTEM_PROMPT = `Your goal is to implement the requested changes based on the provided context (issue description or review comments).
Apply the changes directly to the codebase.
Ensure your changes are clean, efficient, and follow existing coding conventions.
Comment on complex or confusing code. Don't leave comments about actions you are taking.
If you need to add dependencies, use the appropriate package manager commands (e.g., npm install).
If you need to run database migrations or other commands, mention them after applying file changes.`;

/**
 * Generates a prompt for handling a new issue.
 * @param payload - The webhook payload for the 'issues.labeled' event.
 * @returns The generated prompt string.
 */
export function generateIssuePrompt(
  payload: WebhookPayloadIssuesLabeled
): string {
  const title = payload.issue.title;
  const body = payload.issue.body;
  const description = body ? `\nIssue description:\n${body}` : "";
  const issuePrompt = `Apply all necessary changes based on below issue description. \nIssue title: ${title}${description}`;
  return `${SYSTEM_PROMPT}\n\n${issuePrompt}`;
}

interface ReviewPromptParams {
  octokit: Octokit;
  payload: WebhookPayloadPullRequestReviewSubmitted;
}

/**
 * Generates a prompt for handling review feedback.
 * Fetches review comments using GraphQL.
 * @param params - Octokit instance and review payload.
 * @returns The generated prompt string, or null if no actionable feedback is found.
 */
export async function generateReviewPrompt({
  octokit,
  payload,
}: ReviewPromptParams): Promise<string | null> {
  const reviewBody = payload.review.body;

  // Fetch comments using GraphQL
  const resp = await octokit.graphql<ReviewAndComments>(reviewAndComments, {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pr: payload.pull_request.number,
  });

  // Find the specific review and format its comments
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

  // Check if there's anything actionable
  if (!reviewBody && (!comments || comments.length === 0)) {
    console.log(
      `Review ${payload.review.id} has no body or comments, skipping prompt generation.`
    );
    return null; // Return null if no actionable feedback
  }

  let reviewPrompt = `Apply all necessary changes based on the following review comments.`;
  if (reviewBody) {
    reviewPrompt += `\n\nOverall review summary:\n${reviewBody}`;
  }
  if (comments && comments.length > 0) {
    reviewPrompt += `\n\nSpecific comments on files:\n${comments}`;
  }
  return `${SYSTEM_PROMPT}\n\n${reviewPrompt}`;
}
