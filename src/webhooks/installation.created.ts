import { WebhookEventDefinition, EmitterWebhookEventName } from "@octokit/webhooks";
import { Octokit } from "octokit";
import { ensureAiderLabelExists } from "../clients/github.js";

// Define the specific payload type for installation.created event
type InstallationCreatedPayload = WebhookEventDefinition<"installation.created">;

/**
 * Handles the 'installation.created' event.
 * This function iterates through the repositories included in the installation
 * and ensures the "aider-request" label exists in each.
 *
 * @param {object} context - The event context.
 * @param {InstallationCreatedPayload} context.payload - The webhook payload.
 * @param {Octokit} context.octokit - An Octokit instance authenticated for the installation.
 */
export async function handleInstallationCreated({
  payload,
  octokit,
}: {
  payload: InstallationCreatedPayload;
  octokit: Octokit;
}): Promise<void> {
  console.log("Handling installation.created event...");

  // The 'installation.created' event can include multiple repositories
  // if the user installs the app on multiple repos at once.
  if (!payload.repositories) {
    console.log("No repositories found in the installation payload.");
    return;
  }

  const installationId = payload.installation.id;
  console.log(`Processing installation ID: ${installationId}`);

  // The octokit instance passed to the handler is already authenticated
  // for the specific installation that triggered the event.

  for (const repo of payload.repositories) {
    // The owner login is available in the installation account details
    const owner = payload.installation.account.login;
    const repoName = repo.name;

    console.log(`Ensuring label exists for repository: ${owner}/${repoName}`);
    try {
      // Use the installation-authenticated octokit instance
      await ensureAiderLabelExists(octokit, owner, repoName);
    } catch (error) {
      // Error is already logged within ensureAiderLabelExists
      console.error(
        `Error ensuring label exists for ${owner}/${repoName}. Continuing with next repository.`
      );
    }
  }

  console.log("Finished processing installation.created event.");
}
