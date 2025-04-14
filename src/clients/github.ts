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
  monthlyPrLimit: 0, // Default limit is 0 for free tier
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
    // Use apps.getSubscriptionPlanForAccount
    const response = await octokit.rest.apps.getSubscriptionPlanForAccount({
      account_id: (await octokit.rest.users.getByUsername({ username: accountName })).data.id,
    });

    const plan = response.data.marketplace_purchase?.plan;

    if (plan) {
      // Map plan details to Subscription interface
      let limit = DEFAULT_SUBSCRIPTION.monthlyPrLimit; // Start with default
      if (plan.bullets) {
         // Example: Look for a bullet like "Up to 20 PRs per month"
         const limitBullet = plan.bullets.find(b => b?.toLowerCase().includes('prs per month'));
         if (limitBullet) {
           const match = limitBullet.match(/(\d+)\s+prs/i);
           if (match && match[1]) {
             limit = parseInt(match[1], 10);
           }
         }
      }

      return {
        isActive: response.data.marketplace_purchase?.on_free_trial || (plan.monthly_price_in_cents ?? 0) > 0,
        monthlyPrLimit: limit,
        renewalDate: response.data.marketplace_purchase?.next_billing_date ?? DEFAULT_SUBSCRIPTION.renewalDate,
      };
    } else {
      // No active plan found, return default
      console.log(`No active marketplace subscription found for ${accountName}. Using default.`);
      return DEFAULT_SUBSCRIPTION;
    }

  } catch (error: any) {
    // Handle cases where the account doesn't exist or has no plan (e.g., 404)
    if (error.status === 404) {
      console.log(`No marketplace subscription found for account ${accountName}. Using default.`);
    } else {
      console.error(`Error retrieving subscription for ${accountName}:`, error);
    }
    return DEFAULT_SUBSCRIPTION; // Fallback to default on error or no plan
  }
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
): Promise<boolean> {
  const enterprise = await getEnterpriseClient([ownerLogin]); // Check enterprise status first
  if (enterprise) {
    console.log(`Account ${ownerLogin} is an enterprise client. Skipping quota check.`);
    return true; // Enterprise clients bypass quota
  }

  console.log(`Account ${ownerLogin} is not an enterprise client. Checking usage quota.`);

  const subscription = await getSubscriptionDetails(octokit, ownerLogin);

  // Note: We might not need isActive check if getSubscriptionDetails handles it by returning 0 limit
  if (!subscription.isActive) {
    console.warn(`Subscription for ${ownerLogin} is not active. Limit: ${subscription.monthlyPrLimit}.`);
    // If limit is 0 for inactive, the check below will handle it.
  }

  const usageData = await getInstallationUsage(installationId); // Fetches or creates usage doc
  const nextBillingDate = new Date(usageData.next_billing_date);

  // Calculate the start of the current billing cycle
  const cycleStartDate = new Date(nextBillingDate);
  cycleStartDate.setMonth(cycleStartDate.getMonth() - 1);

  const prsThisCycle = usageData.pull_requests.filter(pr => new Date(pr.created_at) >= cycleStartDate);
  const currentPrCount = prsThisCycle.length;

  console.log(`Quota check for ${ownerLogin}: Limit=${subscription.monthlyPrLimit}, Used=${currentPrCount}, CycleStart=${cycleStartDate.toISOString()}, NextBilling=${nextBillingDate.toISOString()}`);

  if (currentPrCount >= subscription.monthlyPrLimit) {
    console.warn(`Quota exceeded for ${ownerLogin} (Installation ID: ${installationId}). Limit: ${subscription.monthlyPrLimit}, Used: ${currentPrCount}.`);
    // Use the next_billing_date from the usage data for the comment
    await createQuotaExceededComment(octokit, payload, usageData.next_billing_date.toISOString());
    return false; // Quota exceeded
  }

  console.log(`Quota check passed for ${ownerLogin}.`);
  return true; // Quota check passed
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
