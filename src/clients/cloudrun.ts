import { JobsClient, protos } from "@google-cloud/run";
import { Octokit } from "octokit";

const FULL_JOB_NAME = `projects/${
  process.env.PROJECT_ID || "ai-jr-dev-production"
}/locations/${process.env.LOCATION_ID || "us-central1"}/jobs/${
  process.env.JOB_NAME || "aider-runner"
}`;

export interface RunJobParams {
  installationId: number;
  prompt: string;
  cloneUrlWithoutToken: string;
  branchName: string;
}

/**
 * Runs a Google Cloud Run job with specific parameters for the AI dev task.
 * @param octokit - An authenticated Octokit instance for the installation.
 * @param params - The parameters for running the job. Destructured for easier access.
 * @returns A promise resolving to the operation result.
 */
export async function runCloudRunJob(
  octokit: Octokit,
  { installationId, prompt, cloneUrlWithoutToken, branchName }: RunJobParams
): Promise<any> {
  const jobsClient = new JobsClient();
  try {
    const tokenResponse = await octokit.rest.apps.createInstallationAccessToken(
      {
        installation_id: installationId,
      }
    );
    const accessToken = tokenResponse.data.token;

    const cloneUrlWithToken = `https://x-access-token:${accessToken}@${cloneUrlWithoutToken.slice(
      8 // Remove 'https://'
    )}`;

    const overrides: protos.google.cloud.run.v2.IRunJobRequest["overrides"] = {
      containerOverrides: [
        {
          env: [
            { name: "AIDER_ARGS", value: `--message "${prompt}"` },
            {
              name: "REPO_NAME",
              value: cloneUrlWithToken,
            },
            { name: "BRANCH_NAME", value: branchName },
          ],
        },
      ],
    };

    const [operation] = await jobsClient.runJob({
      name: FULL_JOB_NAME,
      overrides,
    });

    return operation.promise();
  } catch (error) {
    console.error("Error running Cloud Run job:", error);
    throw error;
  }
}
