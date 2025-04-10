import { JobsClient } from "@google-cloud/run";
import { runCloudRunJob, RunJobParams } from "./cloudrun";

// Mock the @google-cloud/run module
jest.mock("@google-cloud/run", () => {
  // Mock the JobsClient constructor
  const mockRunJob = jest.fn().mockResolvedValue([
    {
      promise: jest.fn().mockResolvedValue(["mock_response"]), // Mock the promise() method
    },
  ]);
  return {
    JobsClient: jest.fn().mockImplementation(() => {
      return {
        runJob: mockRunJob,
      };
    }),
  };
});

// Clear mocks before each test
beforeEach(() => {
  // Clear all instances and calls to constructor and all methods:
  (JobsClient as jest.Mock).mockClear();
  // Clear calls specifically to the runJob mock method if needed elsewhere
  const mockJobsClientInstance = new JobsClient();
  (mockJobsClientInstance.runJob as jest.Mock).mockClear();
});

describe("runCloudRunJob", () => {
  const mockParams: RunJobParams = {
    name: "projects/test-project/locations/us-central1/jobs/test-job",
    overrides: {
      containerOverrides: [
        {
          env: [{ name: "TEST_ENV", value: "test_value" }],
        },
      ],
    },
  };

  it("should instantiate JobsClient", async () => {
    await runCloudRunJob(mockParams);
    expect(JobsClient).toHaveBeenCalledTimes(1);
  });

  it("should call jobsClient.runJob with correct parameters", async () => {
    const mockJobsClientInstance = new JobsClient(); // Get instance created by mock
    await runCloudRunJob(mockParams);
    expect(mockJobsClientInstance.runJob).toHaveBeenCalledTimes(1);
    expect(mockJobsClientInstance.runJob).toHaveBeenCalledWith({
      name: mockParams.name,
      overrides: mockParams.overrides,
    });
  });

  it("should return the result of operation.promise()", async () => {
    const result = await runCloudRunJob(mockParams);
    expect(result).toEqual(["mock_response"]);
  });

  it("should throw an error if jobsClient.runJob fails", async () => {
    const mockError = new Error("Failed to run job");
    const mockJobsClientInstance = new JobsClient();
    (mockJobsClientInstance.runJob as jest.Mock).mockRejectedValueOnce(
      mockError
    );

    await expect(runCloudRunJob(mockParams)).rejects.toThrow(mockError);
  });

  it("should handle calls without overrides", async () => {
    const paramsWithoutOverrides: RunJobParams = {
      name: "projects/test-project/locations/us-central1/jobs/test-job-no-override",
    };
    const mockJobsClientInstance = new JobsClient();
    await runCloudRunJob(paramsWithoutOverrides);
    expect(mockJobsClientInstance.runJob).toHaveBeenCalledTimes(1);
    expect(mockJobsClientInstance.runJob).toHaveBeenCalledWith({
      name: paramsWithoutOverrides.name,
      overrides: undefined, // Explicitly check that overrides is undefined
    });
  });
});
