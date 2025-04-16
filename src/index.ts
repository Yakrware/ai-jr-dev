import { App } from "octokit";
import { createNodeMiddleware } from "@octokit/webhooks";
import dotenv from "dotenv";
import { handleIssuesLabeled } from "./webhooks/issues.labeled.js";
import { handlePullRequestReviewSubmitted } from "./webhooks/pull_request_review.submitted.js";
import { handlePullRequestClosed } from "./webhooks/pull_request.closed.js";
import { handleInstallationCreated } from "./webhooks/installation.created.js"; // Import the new handler

dotenv.config();

const octoApp = new App({
  appId: process.env.APP_ID ?? "",
  privateKey: process.env.PRIVATE_KEY ?? "",
  webhooks: {
    secret: process.env.WEBHOOK_SECRET ?? "",
  },
});

// Register webhook handlers
octoApp.webhooks.on("issues.labeled", handleIssuesLabeled);

octoApp.webhooks.on(
  "pull_request_review.submitted",
  handlePullRequestReviewSubmitted
);

octoApp.webhooks.on("pull_request.closed", handlePullRequestClosed);

// Register the new handler for installation creation
octoApp.webhooks.on("installation.created", handleInstallationCreated);

export const webhook = createNodeMiddleware(octoApp.webhooks, { path: "/" });
