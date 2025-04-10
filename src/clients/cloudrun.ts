import { JobsClient, protos } from "@google-cloud/run";
import { App } from "octokit"; // Import App for token generation
import dotenv from "dotenv";

dotenv.config(); // Ensure environment variables are loaded

// Define the full job name using environment variables or defaults
const FULL_JOB_NAME = `projects/${
  process.env.PROJECT_ID || "ai-jr-dev-production" // Use env var or default
}/locations/${process.env.LOCATION_ID || "us-central1"}/jobs/${
  process.env.JOB_NAME || "aider-runner" // Use env var or default
}`;

// Define an interface for the job run parameters for better type safety
export interface RunJobParams {
  installationId: number;
  prompt: string;
  cloneUrlWithoutToken: string;
  branchName: string;
}

// Internal Octokit App instance for token generation
const octoApp = new App({
  appId: process.env.APP_ID ?? "",
  privateKey: process.env.PRIVATE_KEY ?? "",
});

/**
 * Runs a Google Cloud Run job with specific parameters for the AI dev task.
 * @param params - The parameters for running the job, including installation ID, prompt, clone URL, and branch name.
 * @returns A promise resolving to the operation result.
 */
export async function runCloudRunJob(params: RunJobParams): Promise<any> {
  const jobsClient = new JobsClient();
  try {
    // Generate installation access token
    const auth = await octoApp.getInstallationOctokit(params.installationId);
    const tokenResponse =
      await auth.rest.apps.createInstallationAccessToken({
        installation_id: params.installationId,
      });
    const accessToken = tokenResponse.data.token;

    // Construct the clone URL with the token
    const cloneUrlWithToken = `https://x-access-token:${accessToken}@${params.cloneUrlWithoutToken.slice(
      8 // Remove 'https://'
    )}`;

    // Construct the overrides object
    const overrides: protos.google.cloud.run.v2.IRunJobRequest["overrides"] = {
      containerOverrides: [
        {
          env: [
            { name: "AIDER_ARGS", value: `--message "${params.prompt}"` },
            {
              name: "REPO_NAME",
              value: cloneUrlWithToken,
            },
            { name: "BRANCH_NAME", value: params.branchName },
          ],
        },
      ],
    };

    // Run the job
    const [operation] = await jobsClient.runJob({
      name: FULL_JOB_NAME, // Use the constant defined above
      overrides: overrides,
    });
    // Return the promise directly to let the caller handle the result/errors
    return operation.promise();
  } catch (error) {
    console.error("Error running Cloud Run job:", error);
    // Re-throw the error to allow the caller to handle it
    throw error;
  }
}
