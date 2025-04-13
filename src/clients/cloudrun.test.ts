import type { Octokit } from "octokit";
import type { RunJobParams } from "./cloudrun.js";
import type { JobsClient as JobsClientType } from "@google-cloud/run";
import type { Logging as LoggingType } from "@google-cloud/logging";

// Mock the @google-cloud/run module
const mockRunJobPromise = jest.fn().mockResolvedValue([
  {
    logUri:
      "https://console.cloud.google.com/logs/viewer?project=ai-jr-dev-production&advancedFilter=resource.type%3D%22cloud_run_job%22%0Aresource.labels.job_name%3D%22aider-runner%22%0Aresource.labels.location%3D%22us-central1%22%0Alabels.%22run.googleapis.com/execution_name%22%3D%22aider-runner-gbk8c%22",
  },
]);
const mockRunJob = jest.fn().mockResolvedValue([
  {
    promise: mockRunJobPromise,
  },
]);
// @ts-ignore
jest.unstable_mockModule("@google-cloud/run", () => ({
  __esModule: true,
  JobsClient: jest.fn().mockImplementation(() => {
    return {
      runJob: mockRunJob,
    };
  }),
}));
const mockGetEntriesPromise = jest.fn().mockResolvedValue([
  [
    {
      data: "I have no idea what the shape of data is",
    },
  ],
]);
// @ts-ignore
jest.unstable_mockModule("@google-cloud/logging", () => ({
  __esModule: true,
  Logging: jest.fn().mockImplementation(() => {
    return {
      getEntries: mockGetEntriesPromise,
    };
  }),
}));

const { runCloudRunJob } = await import("./cloudrun.js");
const { JobsClient } = await import("@google-cloud/run");
const { Logging } = await import("@google-cloud/logging");

// Define expected job name structure (adjust defaults if needed)
const PROJECT_ID = process.env.PROJECT_ID || "ai-jr-dev-production";
const LOCATION_ID = process.env.LOCATION_ID || "us-central1";
const JOB_NAME = process.env.JOB_NAME || "aider-runner";
const EXPECTED_FULL_JOB_NAME = `projects/${PROJECT_ID}/locations/${LOCATION_ID}/jobs/${JOB_NAME}`;

describe("runCloudRunJob", () => {
  let mockOctokit: Octokit;
  let mockJobsClientInstance: JobsClientType;
  let mockLoggingInstance: LoggingType;

  const mockParams: RunJobParams = {
    installationId: 12345,
    prompt: "Test prompt message",
    cloneUrlWithoutToken: "https://github.com/test-owner/test-repo.git",
    branchName: "test-branch",
  };

  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks();
    // Create a new mock Octokit instance for each test
    mockOctokit = {
      rest: {
        apps: {
          createInstallationAccessToken: jest
            .fn()
            .mockResolvedValue({ data: { token: "mock_access_token" } }),
        },
      },
    } as any;
    // Get the mock JobsClient instance created by the mock constructor
    mockJobsClientInstance = new JobsClient();
    mockLoggingInstance = new Logging();
  });

  it("should instantiate JobsClient", async () => {
    jest.clearAllMocks();
    await runCloudRunJob(mockOctokit, mockParams);
    expect(JobsClient).toHaveBeenCalledTimes(1);
  });

  it("should request an installation access token", async () => {
    await runCloudRunJob(mockOctokit, mockParams);
    expect(
      mockOctokit.rest.apps.createInstallationAccessToken
    ).toHaveBeenCalledTimes(1);
    expect(
      mockOctokit.rest.apps.createInstallationAccessToken
    ).toHaveBeenCalledWith({
      installation_id: mockParams.installationId,
    });
  });

  it("should call jobsClient.runJob with correct parameters and overrides", async () => {
    await runCloudRunJob(mockOctokit, mockParams);

    const expectedCloneUrlWithToken = `https://x-access-token:mock_access_token@github.com/test-owner/test-repo.git`;
    const expectedOverrides = {
      containerOverrides: [
        {
          env: [
            { name: "PROMPT", value: mockParams.prompt },
            { name: "REPO_NAME", value: expectedCloneUrlWithToken },
            { name: "BRANCH_NAME", value: mockParams.branchName },
          ],
        },
      ],
    };

    expect(mockJobsClientInstance.runJob).toHaveBeenCalledTimes(1);
    expect(mockJobsClientInstance.runJob).toHaveBeenCalledWith({
      name: EXPECTED_FULL_JOB_NAME,
      overrides: expectedOverrides,
    });
  });

  it("should return the result of operation.promise()", async () => {
    const result = await runCloudRunJob(mockOctokit, mockParams);
    expect(mockRunJobPromise).toHaveBeenCalledTimes(1);
    expect(result).toEqual("I have no idea what the shape of data is");
  });

  it("should throw an error if jobsClient.runJob fails", async () => {
    const mockError = new Error("Failed to run job");
    (mockJobsClientInstance.runJob as jest.Mock).mockRejectedValueOnce(
      mockError
    );

    await expect(runCloudRunJob(mockOctokit, mockParams)).rejects.toThrow(
      mockError
    );
  });
});
