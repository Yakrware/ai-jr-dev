import { Octokit } from "octokit";
import { WebhookEventDefinition } from "@octokit/webhooks/types";
import { kebabCase } from "../utilities.js";
import { generatePrDescription } from "./openai.js";
import {
  getEnterpriseClient,
  getInstallation,
  Installation,
} from "./mongodb.js";
import { AI_JR_DEV_LABEL_NAME, AI_JR_DEV_LABEL_COLOR } from "../constants.js"; // Import all constants

// Type definitions for payloads used in this client
type IssuesLabeledPayload = WebhookEventDefinition<"issues-labeled">;
type PullRequestReviewSubmittedPayload =
  WebhookEventDefinition<"pull-request-review-submitted">;
type PullRequestClosedPayload = WebhookEventDefinition<"pull-request-closed">;
type InstallationCreatedPayload = WebhookEventDefinition<"installation-created">; // Add this type

// Subscription interface
export interface Subscription {
  monthlyPrLimit: number;
  renewalDate: string; // ISO date string
}

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

const PRICE_LIMITS: { [key: number]: number } = {
  500: 8,
  1000: 20,
  2000: 50,
};

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
export async function createBranch(
  octokit: Octokit,
  payload: IssuesLabeledPayload
): Promise<string> {
  const branchName = `ai-jr-dev/${payload.issue.number}-${kebabCase(
    payload.issue.title
  )}`;

  const defaultBranch = await octokit.rest.repos.getBranch({
    repo: payload.repository.name,
    owner: payload.repository.owner.login,
    branch: payload.repository.default_branch,
  });
  try {
    await octokit.rest.repos.getBranch({
      repo: payload.repository.name,
      owner: payload.repository.owner.login,
      branch: branchName,
    });
    await octokit.rest.git.updateRef({
      repo: payload.repository.name,
      owner: payload.repository.owner.login,
      sha: defaultBranch.data.commit.sha,
      ref: `heads/${branchName}`,
      force: true,
    });
  } catch {
    try {
      await octokit.rest.git.createRef({
        repo: payload.repository.name,
        owner: payload.repository.owner.login,
        sha: defaultBranch.data.commit.sha,
        ref: `refs/heads/${branchName}`,
      });
    } catch {}
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
): Promise<Subscription | null> {
  try {
    // Use apps.getSubscriptionPlanForAccount
    const response = await octokit.rest.apps.getSubscriptionPlanForAccount({
      account_id: (
        await octokit.rest.users.getByUsername({ username: accountName })
      ).data.id,
    });

    const marketplace_purchase = response.data.marketplace_purchase;

    if (
      marketplace_purchase &&
      marketplace_purchase.next_billing_date &&
      marketplace_purchase.plan
    ) {
      return {
        monthlyPrLimit:
          PRICE_LIMITS[marketplace_purchase.plan.monthly_price_in_cents],
        renewalDate: marketplace_purchase.next_billing_date,
      };
    } else {
      return null;
    }
  } catch (error: any) {
    return null; // Fallback to default on error or no plan
  }
}

export async function getInstallationFromOwner({
  octokit,
  payload,
}: {
  octokit: Octokit;
  payload: IssuesLabeledPayload | PullRequestReviewSubmittedPayload;
}) {
  const enterprise = await getEnterpriseClient([
    payload.repository.owner.login,
  ]); // Check enterprise status first
  if (enterprise) {
    return await getInstallation(
      payload.installation?.id as number,
      "2100-01-01"
    ); // Enterprise clients bypass quota
  }

  const subscription = await getSubscriptionDetails(
    octokit,
    payload.repository.owner.login
  );

  return await getInstallation(
    payload.installation?.id as number,
    subscription?.renewalDate as string
  ); // Fetches or creates usage doc
}

/**
 * Checks if the account has exceeded their monthly PR quota and notifies if necessary.
 * Returns true if the quota check passes, false otherwise.
 */
export async function checkQuotaAndNotify(
  octokit: Octokit,
  payload: IssuesLabeledPayload,
  installationId: number,
  ownerLogin: string
): Promise<Installation | null> {
  const enterprise = await getEnterpriseClient([ownerLogin]); // Check enterprise status first
  if (enterprise) {
    return await getInstallation(
      payload.installation?.id as number,
      "2100-01-01"
    ); // Enterprise clients bypass quota
  }

  const subscription = await getSubscriptionDetails(octokit, ownerLogin);

  // Note: We might not need isActive check if getSubscriptionDetails handles it by returning 0 limit
  if (!subscription) {
    // create a comment that says we couldn't find an active subscription
    await octokit.rest.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      body: "⚠️ **Subscription Not Found**\n\nI couldn't find an active subscription for your account. Please ensure you have an active subscription or start a new one to use AI features.",
    });
    // Remove the AI label as we cannot proceed
    if (payload.label?.name) {
      try {
        await octokit.rest.issues.removeLabel({
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          issue_number: payload.issue.number,
          name: payload.label.name,
        });
      } catch (labelError) {
        console.error(
          `Failed to remove label '${payload.label.name}' after subscription check failed:`,
          labelError
        );
        // Continue even if label removal fails
      }
    }
    return null;
  }

  const installation = await getInstallation(
    installationId,
    subscription.renewalDate
  ); // Fetches or creates usage doc

  const prCount =
    installation?.pullRequests?.reduce(
      (tot, pr) => tot + Math.ceil(pr.cost / 0.25),
      0
    ) || 0;

  if (prCount >= subscription.monthlyPrLimit) {
    await createQuotaExceededComment(
      octokit,
      payload,
      installation?.renewalDate
    );
    return null; // Quota exceeded
  }

  return installation; // Quota check passed
}

/**
 * Creates a comment on the issue explaining that the quota has been exceeded.
 */
export async function createQuotaExceededComment(
  octokit: Octokit,
  payload: IssuesLabeledPayload,
  renewalDate: string | undefined
): Promise<void> {
  const formattedDate =
    renewalDate &&
    new Date(renewalDate).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  await octokit.rest.issues.createComment({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issue_number: payload.issue.number,
    body: `⚠️ **Monthly AI PR Quota Exceeded**\n\nI'm sorry, but you've reached your monthly limit for AI-generated pull requests. ${
      formattedDate
        ? `Your quota will reset on ${formattedDate}.\n\nPlease try again after that date, or consider upgrading your subscription for a higher limit.`
        : `Please consider renewing your subscription.`
    }`,
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
 * Creates a specific label in a repository if it doesn't exist.
 */
export async function ensureLabelExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  labelName: string
): Promise<void> {
  let labelColor: string;
  let labelDescription: string;

  // Determine color and description based on the label name
  if (labelName === AI_JR_DEV_LABEL_NAME) {
    labelColor = AI_JR_DEV_LABEL_COLOR;
    labelDescription = "Assign this issue to AI Jr Dev";
  } else {
    // Default or handle other labels if necessary
    console.warn(`No predefined color/description for label: ${labelName}`);
    // Provide some defaults or throw an error if unexpected labels are passed
    labelColor = "ededed"; // Default grey
    labelDescription = ""; // Default empty description
  }
  try {
    console.log(`Attempting to create label "${labelName}" in ${owner}/${repo}`);
    await octokit.rest.issues.createLabel({
      owner,
      repo,
      name: labelName,
      color: labelColor,
      description: labelDescription,
    });
    console.log(`Label "${labelName}" created successfully in ${owner}/${repo}.`);
  } catch (error: any) {
    // Check if the error is because the label already exists (HTTP 422)
    if (
      error.status === 422 &&
      error.response?.data?.errors?.[0]?.code === "already_exists"
    ) {
      console.log(
        `Label "${labelName}" already exists in ${owner}/${repo}.`
      );
      // Label already exists, which is fine.
    } else {
      // Log other errors
      console.error(
        `Failed to create label "${labelName}" in ${owner}/${repo}:`,
        error
      );
      // Re-throw or handle differently if needed, but for now, just log.
    }
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
