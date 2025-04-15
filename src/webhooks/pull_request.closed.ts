import { Octokit } from "octokit";
import { WebhookEventMap } from "@octokit/webhooks-types";
import { closeIssueForMergedPr } from "../clients/github.js";
import { WATCHED_LABELS, APP_USER_ID } from "../constants.js";

type PullRequestClosedPayload = WebhookEventMap["pull_request.closed"];
type PullRequestClosedOctokit = Octokit; // Or a more specific Octokit instance type

export async function handlePullRequestClosed({
  payload,
  octokit,
}: {
  payload: PullRequestClosedPayload;
  octokit: PullRequestClosedOctokit;
}) {
  if (!payload.installation) return;

  // Check if the PR was merged and (created by our app OR has a watched label)
  const isAppPr = payload.pull_request.user?.id === APP_USER_ID;
  const hasWatchedLabel = payload.pull_request.labels.some((label) =>
    WATCHED_LABELS.includes(label.name)
  );

  if (payload.pull_request.merged && (isAppPr || hasWatchedLabel)) {
    try {
      await closeIssueForMergedPr(octokit, payload);
    } catch (e: any) {
      console.error("Error processing PR closed event:", e);
      // Potentially add error handling comment on the PR or related issue if the client function didn't handle it
    }
  }
}
