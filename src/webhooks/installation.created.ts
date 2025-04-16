import { WebhookEventDefinition } from "@octokit/webhooks/types";
import { Octokit } from "octokit";
import { ensureLabelExists } from "../clients/github.js";

// Define the specific payload type for installation.created event
type InstallationCreatedPayload =
  WebhookEventDefinition<"installation-created">;

/**
 * Handles the 'installation.created' event.
 * This function iterates through the repositories included in the installation
 * and ensures the "ai-jr-dev" label exists in each.
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
  // The 'installation.created' event can include multiple repositories
  // if the user installs the app on multiple repos at once, or potentially
  // a single 'repository' object if installed on just one (less common).
  const repositories =
    payload.repositories || (payload.repository && [payload.repository]); // Use payload.repositories preferentially

  if (!repositories || repositories.length === 0) {
    console.warn(
      "No specific repositories found in the installation payload. Label creation skipped."
    );
    // If needed, you could attempt to list all repos accessible by the installation,
    // but that might be resource-intensive and require different permissions.
    return;
  }

  const installationId = payload.installation.id;

  // The octokit instance passed to the handler is already authenticated
  // for the specific installation that triggered the event.

  for (const repo of repositories) {
    // The owner login is available in the installation account details
    let owner: string = "";
    if (
      payload.installation.account &&
      "login" in payload.installation.account
    ) {
      owner = payload.installation.account.login;
    } else if (payload.organization) {
      owner = payload.organization.login;
    } else if (payload.repository) {
      owner = payload.repository.owner.login;
    }

    const repoName = repo.name;

    if (!owner) {
      console.error(
        `Could not determine owner for repository ${repo.name}. Skipping label creation.`
      );
      continue; // Skip this repo if owner is missing
    }

    try {
      // Ensure "ai-jr-dev" label exists
      await ensureLabelExists(octokit, owner, repoName);
    } catch (error) {
      // Error is already logged within ensureLabelExists
      console.error(
        `Error ensuring labels exist for ${owner}/${repoName}. Continuing with next repository.`
      );
    }
  }
}
