import { WebhookEventDefinition } from "@octokit/webhooks/types";
import { Octokit } from "octokit";
import { ensureLabelExists } from "../clients/github.js";
import {
  AI_JR_DEV_LABEL_NAME,
  AI_JR_DEV_LABEL_COLOR
} from "../constants.js"; // Import all needed constants

// Define the specific payload type for installation.created event
type InstallationCreatedPayload = WebhookEventDefinition<"installation-created">;

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
  // if the user installs the app on multiple repos at once, or potentially
  // a single 'repository' object if installed on just one (less common).
  const repositories = payload.repositories; // Use payload.repositories preferentially

  if (!repositories || repositories.length === 0) {
    console.log(
      "No specific repositories found in the installation payload. Label creation skipped."
    );
    // If needed, you could attempt to list all repos accessible by the installation,
    // but that might be resource-intensive and require different permissions.
    return;
  }

  const installationId = payload.installation.id;
  console.log(`Processing installation ID: ${installationId}`);

  // The octokit instance passed to the handler is already authenticated
  // for the specific installation that triggered the event.

  for (const repo of repositories) {
    // The owner login is available in the installation account details
    const owner = payload.installation.account?.login;
    const repoName = repo.name;

    if (!owner) {
      console.error(
        `Could not determine owner for repository ${repo.name}. Skipping label creation.`
      );
      continue; // Skip this repo if owner is missing
    }

    console.log(`Ensuring labels exist for repository: ${owner}/${repoName}`);
    try {
      // Ensure "ai-jr-dev" label exists
      await ensureLabelExists(
        octokit,
        owner,
        repoName,
        AI_JR_DEV_LABEL_NAME
      );
    } catch (error) {
      // Error is already logged within ensureLabelExists
      console.error(
        `Error ensuring labels exist for ${owner}/${repoName}. Continuing with next repository.`
      );
    }
  }

  console.log("Finished processing installation.created event.");
}
