import { Octokit } from "octokit";
import { WebhookEventDefinition } from "@octokit/webhooks/types";
import { kebabCase } from "../utilities.js";
import { generatePrDescription } from "./openai.js";

// Type definitions for payloads used in this client
type IssuesLabeledPayload = WebhookEventDefinition<"issues-labeled">;
type PullRequestReviewSubmittedPayload =
  WebhookEventDefinition<"pull-request-review-submitted">;
type PullRequestClosedPayload = WebhookEventDefinition<"pull-request-closed">;

// Subscription interface
export interface Subscription {
  isActive: boolean;
  monthlyPrLimit: number;
  renewalDate: string; // ISO date string
}

// Default subscription values
const DEFAULT_SUBSCRIPTION: Subscription = {
  isActive: true,
  monthlyPrLimit: 5, // Default limit for free tier
  renewalDate: new Date(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    1
  ).toISOString(), // First day of next month
};

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
 * Checks if the target branch has a different SHA than the default branch.
 * Returns true if the SHAs are different (branch has changed), false otherwise.
 */
interface HasBranchChangedParams {
  octokit: Octokit;
  repository: IssuesLabeledPayload["repository"]; // Use the repository type from the payload
  branchName: string;
}
export async function hasBranchChanged({
  octokit,
  repository,
  branchName,
}: HasBranchChangedParams): Promise<boolean> {
  const owner = repository.owner.login;
  const repo = repository.name;
  const defaultBranchName = repository.default_branch;

  try {
    const [branchData, defaultBranchData] = await Promise.all([
      octokit.rest.repos.getBranch({ owner, repo, branch: branchName }),
      octokit.rest.repos.getBranch({ owner, repo, branch: defaultBranchName }),
    ]);

    const branchSha = branchData.data.commit.sha;
    const defaultBranchSha = defaultBranchData.data.commit.sha;

    return branchSha !== defaultBranchSha;
  } catch (error) {
    console.error(
      `Error comparing branches ${branchName} and ${defaultBranchName}:`,
      error
    );
    // If we can't compare, assume no change or handle error as needed.
    // Returning false might prevent unnecessary PRs if something is wrong.
    return false;
  }
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
 * Generates a description based on the job output.
 * Returns the full PR response object.
 */
export async function createPullRequest(
  octokit: Octokit,
  payload: IssuesLabeledPayload,
  branchName: string,
  jobOutput: string
) {
  let prBody = "AI-generated changes."; // Default body

  try {
    // Generate PR description from job output
    prBody = await generatePrDescription(jobOutput);
  } catch (error) {
    console.error("Failed to generate PR description:", error);
    // Use the default body defined above
  }

  const prResponse = await octokit.rest.pulls.create({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    title: `[AI] ${payload.issue.title}`,
    head: branchName,
    base: payload.repository.default_branch,
    body: prBody, // Use the generated or default body
  });

  // Call createPrLinkedComment internally
  await createPrLinkedComment(octokit, payload, prResponse.data.html_url);

  return prResponse; // Return the full response object
}

/**
 * Retrieves subscription details for a GitHub account.
 * This would typically query a database or external service.
 * For now, it returns default values.
 */
export async function getSubscriptionDetails(
  octokit: Octokit,
  accountName: string
): Promise<Subscription> {
  try {
    // TODO: Replace with actual database/API call to get subscription details
    // This is a placeholder implementation
    
    // For demonstration, we'll check if the account is a sponsor
    // This could be replaced with your actual subscription logic
    try {
      const sponsorshipResponse = await octokit.rest.sponsors.getForAuthenticatedUser({
        username: accountName
      });
      
      // If we get here, they're a sponsor - give them a higher limit
      if (sponsorshipResponse.status === 200) {
        return {
          isActive: true,
          monthlyPrLimit: 20, // Higher limit for sponsors
          renewalDate: DEFAULT_SUBSCRIPTION.renewalDate,
        };
      }
    } catch (error) {
      // Not a sponsor, continue with default handling
      console.log(`${accountName} is not a sponsor, using default subscription.`);
    }
    
    // Return default subscription for now
    return DEFAULT_SUBSCRIPTION;
  } catch (error) {
    console.error(`Error retrieving subscription for ${accountName}:`, error);
    return DEFAULT_SUBSCRIPTION; // Fallback to default on error
  }
}

/**
 * Creates a comment on the issue explaining that the quota has been exceeded.
 */
export async function createQuotaExceededComment(
  octokit: Octokit,
  payload: IssuesLabeledPayload,
  renewalDate: string
): Promise<void> {
  const formattedDate = new Date(renewalDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  await octokit.rest.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: payload.issue.number,
    body: `⚠️ **Monthly AI PR Quota Exceeded**\n\nI'm sorry, but you've reached your monthly limit for AI-generated pull requests. Your quota will reset on ${formattedDate}.\n\nPlease try again after that date, or consider upgrading your subscription for a higher limit.`,
  });
  
  // Remove the AI label to indicate we're not processing this
  if (payload.label?.name) {
    await octokit.rest.issues.removeLabel({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      name: payload.label.name,
    });
  }
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

/**
 * Comments on and closes the corresponding issue when an AI-generated PR is merged.
 */
export async function closeIssueForMergedPr(
  octokit: Octokit,
  payload: PullRequestClosedPayload
): Promise<void> {
  const branchName = payload.pull_request.head.ref;
  // Matches branches like ai-jr-dev/123-some-title
  const match = branchName.match(/^ai-jr-dev\/(\d+)-/);

  if (!match || !match[1]) {
    console.warn(
      `PR #${payload.pull_request.number}: Could not extract issue number from branch name: ${branchName}. Skipping issue close.`
    );
    return;
  }

  const issueNumber = parseInt(match[1], 10);

  try {
    // Comment on the issue
    await octokit.rest.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: issueNumber,
      body: `Pull request #${payload.pull_request.number} merged. Closing this issue.`,
    });

    // Close the issue
    await octokit.rest.issues.update({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: issueNumber,
      state: "closed",
    });

    console.log(
      `Closed issue #${issueNumber} for merged PR #${payload.pull_request.number}`
    );
  } catch (error) {
    console.error(
      `Failed to close issue #${issueNumber} for PR #${payload.pull_request.number}:`,
      error
    );
    // Optionally, add a comment to the PR or issue indicating the failure to close
    try {
      await octokit.rest.issues.createComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: issueNumber,
        body: `Attempted to close this issue after PR #${payload.pull_request.number} was merged, but encountered an error. Please close manually if appropriate.`,
      });
    } catch (commentError) {
      console.error("Failed to add error comment to issue:", commentError);
    }
  }
}
