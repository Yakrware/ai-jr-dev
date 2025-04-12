import type { Octokit } from "octokit";
import type { RunJobParams } from "./cloudrun.js";
import type { JobsClient as JobsClientType } from "@google-cloud/run";

// Mock the @google-cloud/run module
const mockRunJobPromise = jest.fn().mockResolvedValue(["mock_job_result"]);
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
const { runCloudRunJob } = await import("./cloudrun.js");

const { JobsClient } = await import("@google-cloud/run");

// Define expected job name structure (adjust defaults if needed)
const PROJECT_ID = process.env.PROJECT_ID || "ai-jr-dev-production";
const LOCATION_ID = process.env.LOCATION_ID || "us-central1";
const JOB_NAME = process.env.JOB_NAME || "aider-runner";
const EXPECTED_FULL_JOB_NAME = `projects/${PROJECT_ID}/locations/${LOCATION_ID}/jobs/${JOB_NAME}`;

describe("runCloudRunJob", () => {
  let mockOctokit: Octokit;
  let mockJobsClientInstance: JobsClientType;

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
    expect(result).toEqual(["mock_job_result"]);
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
