import { generateIssuePrompt, generateReviewPrompt } from "./prompt.js";
import { ReviewAndComments } from "../queries.js"; // Import GraphQL response type
import { WebhookEventDefinition } from "@octokit/webhooks/types";

// Basic check for the system prompt inclusion - updated to match prompt.ts
const SYSTEM_PROMPT_CHECK =
  "Generate plan then implement the following feature:";

// --- Mocks for generateIssuePrompt ---

type WebhookPayloadIssuesLabeled = WebhookEventDefinition<"issues-labeled">;
type WebhookPayloadPullRequestReviewSubmitted =
  WebhookEventDefinition<"pull-request-review-submitted">;

const mockIssueLabeledPayloadBase: WebhookPayloadIssuesLabeled = {
  action: "labeled",
  issue: {
    number: 1,
    title: "Test Issue",
    body: "This is the issue body.",
    user: { login: "test-user" }, // Added required fields
    state: "open",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    html_url: "http://example.com/issue/1",
    id: 1,
    node_id: "issue-node-id",
    // ... other required issue properties
  },
  repository: {
    id: 123,
    node_id: "repo-node-id", // Added required fields
    name: "test-repo",
    full_name: "test-owner/test-repo",
    private: false,
    owner: { login: "test-owner", id: 1, node_id: "owner-node-id" },
    html_url: "http://example.com/repo",
    // ... other required repo properties
  },
  label: {
    name: "aider",
    id: 1,
    node_id: "label-node-id",
    color: "ffffff",
    default: false,
    description: "",
  }, // Example label with required fields
  installation: { id: 1, node_id: "install-node-id" }, // Example installation with required fields
  sender: { login: "sender-user", id: 2, node_id: "sender-node-id" }, // Added required sender
  // ... other payload properties
} as any; // Using 'as any' for brevity, ideally mock the full type

// --- Mocks for generateReviewPrompt ---

const mockReviewSubmittedPayloadBase: WebhookPayloadPullRequestReviewSubmitted =
  {
    action: "submitted",
    review: {
      id: 101,
      node_id: "review-node-id-101",
      user: { login: "reviewer", id: 3, node_id: "reviewer-node-id" }, // Added required fields
      body: "Overall feedback.",
      state: "changes_requested",
      html_url: "http://example.com/review/101", // Added required fields
      pull_request_url: "http://example.com/pr/42",
      _links: { html: { href: "" }, pull_request: { href: "" } },
      submitted_at: new Date().toISOString(),
      commit_id: "commit-sha",
      author_association: "COLLABORATOR",
      // ... other required review properties
    },
    pull_request: {
      number: 42,
      id: 42, // Added required fields
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
      }, // Simplified head/base
      base: {
        ref: "main",
        sha: "base-sha",
        repo: { id: 123, name: "test-repo", owner: { login: "test-owner" } },
      },
      // ... other required PR properties
    },
    repository: {
      id: 123,
      node_id: "repo-node-id-pr", // Added required fields
      name: "test-repo",
      full_name: "test-owner/test-repo",
      private: false,
      owner: { login: "test-owner", id: 1, node_id: "owner-node-id-pr" },
      html_url: "http://example.com/repo",
      // ... other required repo properties
    },
    installation: { id: 1, node_id: "install-node-id-pr" }, // Example installation with required fields
    sender: { login: "sender-user-pr", id: 5, node_id: "sender-node-id-pr" }, // Added required sender
    // ... other payload properties
  } as any; // Using 'as any' for brevity

// Mock Octokit instance
const mockOctokit = {
  graphql: jest.fn(),
} as any; // Using 'as any' for mocking simplicity to resolve type errors

// --- Tests ---

describe("generateIssuePrompt", () => {
  it("should generate a prompt with title and body", () => {
    const payload: WebhookPayloadIssuesLabeled = {
      ...mockIssueLabeledPayloadBase,
      issue: {
        ...mockIssueLabeledPayloadBase.issue,
        title: "Test Issue",
        body: "This is the issue body.",
      },
    };
    // Pass the full payload object
    const prompt = generateIssuePrompt(payload);
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Short description: Test Issue");
    // Updated check for issue body format
    expect(prompt).toContain("More details: This is the issue body.");
  });

  it("should generate a prompt with title only when body is null", () => {
    const payload: WebhookPayloadIssuesLabeled = {
      ...mockIssueLabeledPayloadBase,
      issue: {
        ...mockIssueLabeledPayloadBase.issue,
        title: "Test Issue No Body",
        body: null,
      },
    };
    // Pass the full payload object
    const prompt = generateIssuePrompt(payload);
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Short description: Test Issue No Body");
    // Updated check: "More details:" should not be present if body is null
    expect(prompt).not.toContain("More details:");
  });

  it("should generate a prompt with title only when body is empty string", () => {
    const payload: WebhookPayloadIssuesLabeled = {
      ...mockIssueLabeledPayloadBase,
      issue: {
        ...mockIssueLabeledPayloadBase.issue,
        title: "Test Issue Empty Body",
        body: "",
      },
    };
    // Pass the full payload object
    const prompt = generateIssuePrompt(payload);
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Short description: Test Issue Empty Body");
    // Updated check: An empty body results in the body line being added but empty
    expect(prompt).not.toContain("More details: ");
  });
});

describe("generateReviewPrompt", () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("should generate a prompt with review body and comments", async () => {
    const payload = {
      ...mockReviewSubmittedPayloadBase,
      review: {
        ...mockReviewSubmittedPayloadBase.review,
        node_id: "review-node-id-1",
        body: "Overall feedback.",
      },
    };
    const mockGraphQLResponse: ReviewAndComments = {
      repository: {
        pullRequest: {
          reviews: {
            nodes: [
              {
                id: "review-node-id-1", // Match the payload review node_id
                bodyText: "",
                comments: {
                  nodes: [
                    {
                      path: "test.ts",
                      id: "",
                      line: 5,
                      startLine: 0,
                      bodyText: "Fix this.",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = jest.fn().mockResolvedValue(mockGraphQLResponse);

    // Pass octokit and payload
    const prompt = await generateReviewPrompt({
      octokit: mockOctokit,
      payload,
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    // Updated check for review summary format
    expect(prompt).toContain("Review summary:\nOverall feedback.");
    // Updated check for file comments format
    expect(prompt).toContain(
      "File comments:\n1. file: test.ts; line: 5; change: Fix this."
    );
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
    // Verify graphql call parameters
    expect(mockOctokit.graphql).toHaveBeenCalledWith(expect.any(String), {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      pr: payload.pull_request.number,
    });
  });

  it("should generate a prompt with multi-line comments", async () => {
    const payload = {
      ...mockReviewSubmittedPayloadBase,
      review: {
        ...mockReviewSubmittedPayloadBase.review,
        node_id: "review-node-id-multi",
        body: "Multi-line feedback.",
      },
    };
    const mockGraphQLResponse: ReviewAndComments = {
      repository: {
        pullRequest: {
          reviews: {
            nodes: [
              {
                id: "review-node-id-multi", // Match the payload review node_id
                bodyText: "",
                comments: {
                  nodes: [
                    {
                      path: "file.js",
                      id: "",
                      line: 15,
                      startLine: 10, // Different start line
                      bodyText: "Address this range.",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = jest.fn().mockResolvedValue(mockGraphQLResponse);

    // Pass octokit and payload
    const prompt = await generateReviewPrompt({
      octokit: mockOctokit,
      payload,
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    // Updated check for review summary format
    expect(prompt).toContain("Review summary:\nMulti-line feedback.");
    // Updated check for file comments format
    expect(prompt).toContain(
      "File comments:\n1. file: file.js; lines: 10-15; change: Address this range."
    );
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
  });

  it("should generate a prompt with review body only", async () => {
    const payload = {
      ...mockReviewSubmittedPayloadBase,
      review: {
        ...mockReviewSubmittedPayloadBase.review,
        node_id: "review-node-id-2",
        body: "Overall feedback.",
      },
    };
    const mockGraphQLResponse: ReviewAndComments = {
      repository: {
        pullRequest: {
          reviews: {
            nodes: [
              {
                id: "review-node-id-2", // Match the payload review node_id
                bodyText: "",
                comments: { nodes: [] }, // No comments
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = jest.fn().mockResolvedValue(mockGraphQLResponse);

    // Pass octokit and payload
    const prompt = await generateReviewPrompt({
      octokit: mockOctokit,
      payload,
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    // Updated check for review summary format
    expect(prompt).toContain("Review summary:\nOverall feedback.");
    // Updated check: File comments section should not be present
    expect(prompt).not.toContain("File comments:");
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
  });

  it("should generate a prompt with comments only", async () => {
    const payload = {
      ...mockReviewSubmittedPayloadBase,
      review: {
        ...mockReviewSubmittedPayloadBase.review,
        node_id: "review-node-id-3",
        body: null, // No body
      },
    };
    const mockGraphQLResponse: ReviewAndComments = {
      repository: {
        pullRequest: {
          reviews: {
            nodes: [
              {
                id: "review-node-id-3", // Match the payload review node_id
                bodyText: "",
                comments: {
                  nodes: [
                    {
                      path: "test.ts",
                      id: "",
                      line: 5,
                      startLine: 0,
                      bodyText: "Fix this.",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = jest.fn().mockResolvedValue(mockGraphQLResponse);

    // Pass octokit and payload
    const prompt = await generateReviewPrompt({
      octokit: mockOctokit,
      payload,
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    // Updated check: Review summary section should not be present
    expect(prompt).not.toContain("Review summary:");
    // Updated check for file comments format
    expect(prompt).toContain(
      "File comments:\n1. file: test.ts; line: 5; change: Fix this."
    );
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
  });

  it("should generate a prompt with comments only when review body is empty string", async () => {
    const payload = {
      ...mockReviewSubmittedPayloadBase,
      review: {
        ...mockReviewSubmittedPayloadBase.review,
        node_id: "review-node-id-4",
        body: "", // Empty body
      },
    };
    const mockGraphQLResponse: ReviewAndComments = {
      repository: {
        pullRequest: {
          reviews: {
            nodes: [
              {
                id: "review-node-id-4", // Match the payload review node_id
                bodyText: "",
                comments: {
                  nodes: [
                    {
                      path: "test.ts",
                      id: "",
                      line: 5,
                      startLine: 0,
                      bodyText: "Fix this.",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = jest.fn().mockResolvedValue(mockGraphQLResponse);

    // Pass octokit and payload
    const prompt = await generateReviewPrompt({
      octokit: mockOctokit,
      payload,
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    // Updated check: An empty body results in the summary line being added but empty
    expect(prompt).not.toContain("Review summary:\n");
    // Updated check for file comments format
    expect(prompt).toContain(
      "File comments:\n1. file: test.ts; line: 5; change: Fix this."
    );
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
  });

  it("should generate a prompt with review body only when comments are empty", async () => {
    const payload = {
      ...mockReviewSubmittedPayloadBase,
      review: {
        ...mockReviewSubmittedPayloadBase.review,
        node_id: "review-node-id-5",
        body: "Overall feedback.",
      },
    };
    const mockGraphQLResponse: ReviewAndComments = {
      repository: {
        pullRequest: {
          reviews: {
            nodes: [
              {
                id: "review-node-id-5", // Match the payload review node_id
                bodyText: "",
                comments: { nodes: [] }, // Empty comments array
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = jest.fn().mockResolvedValue(mockGraphQLResponse);

    // Pass octokit and payload
    const prompt = await generateReviewPrompt({
      octokit: mockOctokit,
      payload,
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    // Updated check for review summary format
    expect(prompt).toContain("Review summary:\nOverall feedback.");
    // Updated check: Empty comments result in the comments line NOT being added
    expect(prompt).not.toContain("File comments:");
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
  });

  it("should return null if both body and comments are missing/empty", async () => {
    const payload = {
      ...mockReviewSubmittedPayloadBase,
      review: {
        ...mockReviewSubmittedPayloadBase.review,
        node_id: "review-node-id-6",
        body: null, // No body
      },
    };
    const mockGraphQLResponse: ReviewAndComments = {
      repository: {
        pullRequest: {
          reviews: {
            nodes: [
              {
                id: "review-node-id-6", // Match the payload review node_id
                bodyText: "",
                comments: { nodes: [] }, // No comments
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = jest.fn().mockResolvedValue(mockGraphQLResponse);

    // Pass octokit and payload
    const prompt = await generateReviewPrompt({
      octokit: mockOctokit,
      payload,
    });
    expect(prompt).toBeNull(); // Expect null when no actionable feedback
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
  });

  it("should return null if the specific review is not found in GraphQL response and body is blank", async () => {
    const payload = {
      ...mockReviewSubmittedPayloadBase,
      review: {
        ...mockReviewSubmittedPayloadBase.review,
        node_id: "review-node-id-not-found", // This ID won't match
        body: "",
      },
    };
    const mockGraphQLResponse: ReviewAndComments = {
      repository: {
        pullRequest: {
          reviews: {
            nodes: [
              // Does not contain 'review-node-id-not-found'
              {
                id: "review-node-id-other",
                bodyText: "",
                comments: { nodes: [] },
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = jest.fn().mockResolvedValue(mockGraphQLResponse);

    // Pass octokit and payload
    const prompt = await generateReviewPrompt({
      octokit: mockOctokit,
      payload,
    });
    expect(prompt).toBeNull(); // Expect null as the relevant review wasn't found
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
  });
});
