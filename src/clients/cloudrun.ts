import { JobsClient, protos } from "@google-cloud/run";

// Define an interface for the job run parameters for better type safety
export interface RunJobParams {
  name: string;
  overrides?: protos.google.cloud.run.v2.IRunJobRequest["overrides"];
}

/**
 * Runs a Google Cloud Run job.
 * @param params - The parameters for running the job, including name and overrides.
 * @returns A promise resolving to the operation result.
 */
export async function runCloudRunJob(params: RunJobParams): Promise<any> {
  const jobsClient = new JobsClient();
  try {
    const [operation] = await jobsClient.runJob({
      name: params.name,
      overrides: params.overrides,
    });
    // Return the promise directly to let the caller handle the result/errors
    return operation.promise();
  } catch (error) {
    console.error("Error running Cloud Run job:", error);
    // Re-throw the error to allow the caller to handle it
    throw error;
  }
}
