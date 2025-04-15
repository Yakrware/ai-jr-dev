import { Logging } from "@google-cloud/logging";
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
  files?: string[]; // Optional list of files to include
}

/**
 * Runs a Google Cloud Run job with specific parameters for the AI dev task.
 * @param octokit - An authenticated Octokit instance for the installation.
 * @param params - The parameters for running the job. Destructured for easier access.
 * @returns A promise resolving to the combined text payload from the job logs.
 */
export async function runCloudRunJob(
  octokit: Octokit,
  {
    installationId,
    prompt,
    cloneUrlWithoutToken,
    branchName,
    files, // Destructure the files parameter
  }: RunJobParams
): Promise<string> {
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

    const filesArg =
      files && files.length > 0
        ? files.map((f) => `--file ${f}`).join(" ")
        : "";

    const overrides: protos.google.cloud.run.v2.IRunJobRequest["overrides"] = {
      containerOverrides: [
        {
          env: [
            { name: "PROMPT", value: prompt.replace('"', `\"`) },
            {
              name: "REPO_NAME",
              value: cloneUrlWithToken,
            },
            { name: "BRANCH_NAME", value: branchName },
            {
              name: "FILES",
              value: filesArg,
            },
          ],
        },
      ],
    };

    const [operation] = await jobsClient.runJob({
      name: FULL_JOB_NAME,
      overrides,
    });

    const [response] = await operation.promise();
    const logUri = new URL(response.logUri as string);
    const logging = new Logging();
    const [entries] = await logging.getEntries({
      resourceNames: [`projects/${logUri.searchParams.get("project")}`],
      filter: decodeURI(
        decodeURI(logUri.searchParams.get("advancedFilter") as string)
      ),
    });
    return entries
      .map((e) => e.metadata.textPayload)
      .filter((x) => x)
      .reverse()
      .join("\n");
  } catch (error) {
    if (process.env.NODE_ENV !== "test")
      console.error("Error running Cloud Run job:", error);
    throw error;
  }
}
