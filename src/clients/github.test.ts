import { Octokit } from "octokit";
import { WebhookEventDefinition } from "@octokit/webhooks/types";
import { kebabCase } from "../utilities.js"; // Assuming kebabCase is used internally

// --- Mocks ---

// Mock openai module
const mockPrDescription = "Mocked AI-generated PR description.";
// @ts-ignore
jest.unstable_mockModule("./dist/clients/openai.js", () => ({
  __esModule: true,
  generatePrDescription: jest.fn().mockResolvedValue(mockPrDescription),
  // Mock other exports from openai.js if they are used elsewhere in the test file
  // identifyMissingFiles: jest.fn().mockResolvedValue([]),
}));

// Import AFTER mocks are set up
const { generatePrDescription } = await import("./openai.js");
const {
  createWorkingComment,
  fetchBranch,
  createPullRequest,
  createPrLinkedComment,
  handleIssueError,
  resetReviewRequest,
} = await import("./github.js");

// --- Type Definitions ---
type IssuesLabeledPayload = WebhookEventDefinition<"issues-labeled">;
type PullRequestReviewSubmittedPayload =
  WebhookEventDefinition<"pull-request-review-submitted">;

// --- Mocks ---

// Mock Octokit instance
const mockOctokit = {
  rest: {
    issues: {
      createComment: jest.fn(),
      removeLabel: jest.fn(),
    },
    repos: {
      getBranch: jest.fn(),
    },
    git: {
      createRef: jest.fn(),
    },
    pulls: {
      create: jest.fn(),
      requestReviewers: jest.fn(),
    },
  },
} as unknown as Octokit; // Use unknown for type safety during mock creation

// Mock Payloads (similar structure to prompt.test.ts, ensure required fields)
const mockIssueLabeledPayloadBase: IssuesLabeledPayload = {
  action: "labeled",
  issue: {
    number: 1,
    title: "Test Issue",
    body: "This is the issue body.",
    user: { login: "test-user" },
    state: "open",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    html_url: "http://example.com/issue/1",
    id: 1,
    node_id: "issue-node-id",
  },
  repository: {
    id: 123,
    node_id: "repo-node-id",
    name: "test-repo",
    full_name: "test-owner/test-repo",
    private: false,
    owner: { login: "test-owner", id: 1, node_id: "owner-node-id" },
    html_url: "http://example.com/repo",
    default_branch: "main", // Added default_branch
  },
  label: {
    name: "aider",
    id: 1,
    node_id: "label-node-id",
    color: "ffffff",
    default: false,
    description: "",
  },
  installation: { id: 1, node_id: "install-node-id" },
  sender: { login: "sender-user", id: 2, node_id: "sender-node-id" },
} as any; // Using 'as any' for brevity

const mockReviewSubmittedPayloadBase: PullRequestReviewSubmittedPayload = {
  action: "submitted",
  review: {
    id: 101,
    node_id: "review-node-id-101",
    user: { login: "reviewer", id: 3, node_id: "reviewer-node-id" },
    body: "Overall feedback.",
    state: "changes_requested",
    html_url: "http://example.com/review/101",
    pull_request_url: "http://example.com/pr/42",
    _links: { html: { href: "" }, pull_request: { href: "" } },
    submitted_at: new Date().toISOString(),
    commit_id: "commit-sha",
    author_association: "COLLABORATOR",
  },
  pull_request: {
    number: 42,
    id: 42,
    node_id: "pr-node-id",
    url: "http://example.com/pr/42",
    html_url: "http://example.com/pr/42",
    state: "open",
    title: "Test PR",
    user: { login: "pr-author", id: 4, node_id: "pr-author-node-id" },
    body: "PR Body",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    head: {
      ref: "feature-branch",
      sha: "head-sha",
      repo: { id: 123, name: "test-repo", owner: { login: "test-owner" } },
    },
    base: {
      ref: "main",
      sha: "base-sha",
      repo: { id: 123, name: "test-repo", owner: { login: "test-owner" } },
    },
  },
  repository: {
    id: 123,
    node_id: "repo-node-id-pr",
    name: "test-repo",
    full_name: "test-owner/test-repo",
    private: false,
    owner: { login: "test-owner", id: 1, node_id: "owner-node-id-pr" },
    html_url: "http://example.com/repo",
  },
  installation: { id: 1, node_id: "install-node-id-pr" },
  sender: { login: "sender-user-pr", id: 5, node_id: "sender-node-id-pr" },
} as any; // Using 'as any' for brevity

// --- Tests ---

describe("GitHub Client Functions", () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe("createWorkingComment", () => {
    it("should call issues.createComment with correct parameters", async () => {
      await createWorkingComment(mockOctokit, mockIssueLabeledPayloadBase);
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 1,
        body: "I'm on it!",
      });
    });
  });

  describe("fetchBranch", () => {
    const expectedBranchName = `ai-jr-dev/1-${kebabCase(
      mockIssueLabeledPayloadBase.issue.title
    )}`;

    it("should return existing branch name if found", async () => {
      (
        mockOctokit.rest.repos.getBranch as unknown as jest.Mock
      ).mockResolvedValueOnce({
        /* mock branch data */
      });
      const branchName = await fetchBranch(
        mockOctokit,
        mockIssueLabeledPayloadBase
      );
      expect(branchName).toBe(expectedBranchName);
      expect(mockOctokit.rest.repos.getBranch).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.repos.getBranch).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        branch: expectedBranchName,
      });
      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
    });

    it("should create and return new branch name if not found", async () => {
      const defaultBranchSha = "default-branch-sha";
      (mockOctokit.rest.repos.getBranch as unknown as jest.Mock)
        .mockRejectedValueOnce(new Error("Not Found")) // First call fails (branch check)
        .mockResolvedValueOnce({
          // Second call succeeds (get default branch)
          data: { commit: { sha: defaultBranchSha } },
        });
      (
        mockOctokit.rest.git.createRef as unknown as jest.Mock
      ).mockResolvedValueOnce({}); // Mock createRef success

      const branchName = await fetchBranch(
        mockOctokit,
        mockIssueLabeledPayloadBase
      );

      expect(branchName).toBe(expectedBranchName);
      expect(mockOctokit.rest.repos.getBranch).toHaveBeenCalledTimes(2);
      // First call (check for ai branch)
      expect(mockOctokit.rest.repos.getBranch).toHaveBeenNthCalledWith(1, {
        owner: "test-owner",
        repo: "test-repo",
        branch: expectedBranchName,
      });
      // Second call (get default branch)
      expect(mockOctokit.rest.repos.getBranch).toHaveBeenNthCalledWith(2, {
        owner: "test-owner",
        repo: "test-repo",
        branch: "main",
      });
      expect(mockOctokit.rest.git.createRef).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.git.createRef).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        ref: `refs/heads/${expectedBranchName}`,
        sha: defaultBranchSha,
      });
    });
  });

  describe("createPullRequest", () => {
    const branchName = "ai-jr-dev/1-test-issue";
    const jobOutput = "This is the log output from the Cloud Run job."; // Define jobOutput
    const mockPrResponse = {
      data: {
        html_url: "http://example.com/pull/5",
        number: 5,
        // ... other PR data
      },
    };

    beforeEach(() => {
      // Clear the mock function's call history before each test
      (generatePrDescription as jest.Mock).mockClear();
      // Mock the pulls.create call
      (mockOctokit.rest.pulls.create as unknown as jest.Mock).mockResolvedValue(
        mockPrResponse
      );
      // Mock the issues.createComment call (used by createPrLinkedComment)
      (
        mockOctokit.rest.issues.createComment as unknown as jest.Mock
      ).mockResolvedValue({});
    });

    it("should call pulls.create with correct parameters", async () => {
      await createPullRequest(
        mockOctokit,
        mockIssueLabeledPayloadBase,
        branchName,
        jobOutput // Pass jobOutput
      );
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        title: "[AI] Test Issue",
        body: mockPrDescription, // Expect the mocked description
        head: branchName,
        base: "main",
      });
    });

    it("should call createPrLinkedComment after creating PR", async () => {
      await createPullRequest(
        mockOctokit,
        mockIssueLabeledPayloadBase,
        branchName,
        jobOutput // Pass jobOutput
      );
      // createPrLinkedComment calls issues.createComment
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 1,
        body: `Pull request created: ${mockPrResponse.data.html_url}`,
      });
    });

    it("should return the full PR response object", async () => {
      const result = await createPullRequest(
        mockOctokit,
        mockIssueLabeledPayloadBase,
        branchName,
        jobOutput // Pass jobOutput
      );
      expect(result).toEqual(mockPrResponse);
    });
  });

  describe("createPrLinkedComment", () => {
    it("should call issues.createComment with correct parameters", async () => {
      const prUrl = "http://example.com/pull/5";
      await createPrLinkedComment(
        mockOctokit,
        mockIssueLabeledPayloadBase,
        prUrl
      );
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 1,
        body: `Pull request created: ${prUrl}`,
      });
    });
  });

  describe("handleIssueError", () => {
    const error = new Error("Test error");

    beforeEach(() => {
      // Mock the API calls
      (
        mockOctokit.rest.issues.createComment as unknown as jest.Mock
      ).mockResolvedValue({});
      (
        mockOctokit.rest.issues.removeLabel as unknown as jest.Mock
      ).mockResolvedValue({});
    });

    it("should create an error comment", async () => {
      await handleIssueError(mockOctokit, mockIssueLabeledPayloadBase, error);
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 1,
        body: expect.stringContaining("I'm sorry, I've actually had an error"),
      });
    });

    it("should remove the label if present", async () => {
      await handleIssueError(mockOctokit, mockIssueLabeledPayloadBase, error);
      expect(mockOctokit.rest.issues.removeLabel).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.issues.removeLabel).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 1,
        name: "aider",
      });
    });

    it("should not attempt to remove label if label is missing", async () => {
      const payloadWithoutLabel = {
        ...mockIssueLabeledPayloadBase,
        label: undefined, // Simulate missing label
      };
      await handleIssueError(mockOctokit, payloadWithoutLabel, error);
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.issues.removeLabel).not.toHaveBeenCalled();
    });

    it("should catch errors during error handling itself", async () => {
      const handlingError = new Error("Failed to create comment");
      (
        mockOctokit.rest.issues.createComment as unknown as jest.Mock
      ).mockRejectedValue(handlingError);
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {}); // Suppress console output during test

      // Expect the function not to throw, but to log the secondary error
      await expect(
        handleIssueError(mockOctokit, mockIssueLabeledPayloadBase, error)
      ).resolves.not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error processing issue label event:",
        JSON.stringify(error)
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to handle issue error gracefully:",
        handlingError
      );

      consoleErrorSpy.mockRestore(); // Restore console.error
    });
  });

  describe("resetReviewRequest", () => {
    it("should call pulls.requestReviewers with the reviewer's login", async () => {
      await resetReviewRequest(mockOctokit, mockReviewSubmittedPayloadBase);
      expect(mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        pull_number: 42,
        reviewers: ["reviewer"],
      });
    });

    it("should not call pulls.requestReviewers if reviewer login is missing", async () => {
      const payloadWithoutReviewerLogin = {
        ...mockReviewSubmittedPayloadBase,
        review: {
          ...mockReviewSubmittedPayloadBase.review,
          user: null, // Simulate missing user
        },
      };
      const consoleWarnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => {}); // Suppress console output

      await resetReviewRequest(mockOctokit, payloadWithoutReviewerLogin);

      expect(mockOctokit.rest.pulls.requestReviewers).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Could not re-request review for PR #42 as reviewer login is missing."
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
