import { Octokit } from "octokit";
import { ReviewAndComments, reviewAndComments } from "../queries.js"; // Import GraphQL query
import { WebhookEventDefinition } from "@octokit/webhooks/types";

// System prompt to guide the AI
const SYSTEM_PROMPT = `Implement the requested changes based on the provided context (issue description or review comments).`;

/**
 * Generates a prompt for handling a new issue.
 * @param payload - The webhook payload for the 'issues.labeled' event.
 * @returns The generated prompt string.
 */
export function generateIssuePrompt(
  payload: WebhookEventDefinition<"issues-labeled">
): string {
  const title = payload.issue.title;
  const body = payload.issue.body;
  const issuePrompt = `Issue title: ${title}
Issue body: ${body}`;
  return `${SYSTEM_PROMPT}\n\n${issuePrompt}`;
}

interface ReviewPromptParams {
  octokit: Octokit;
  payload: WebhookEventDefinition<"pull-request-review-submitted">;
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

  let reviewPrompt = "";
  if (reviewBody) {
    reviewPrompt += `\n\nReview summary:\n${reviewBody}`;
  }
  if (comments && comments.length > 0) {
    reviewPrompt += `\n\nFile comments:\n${comments}`;
  }
  return `${SYSTEM_PROMPT}\n\n${reviewPrompt}`;
}
