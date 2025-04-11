import { generateIssuePrompt, generateReviewPrompt } from "./prompt";
import { describe, it, expect, vi } from "vitest";
import { Octokit } from "octokit"; // Import Octokit type
import {
  WebhookPayloadIssuesLabeled,
  WebhookPayloadPullRequestReviewSubmitted,
} from "@octokit/webhooks-types"; // Import payload types
import { ReviewAndComments } from "../queries"; // Import GraphQL response type

// Basic check for the system prompt inclusion
const SYSTEM_PROMPT_CHECK =
  "You are an AI assistant acting as a junior software developer.";

// --- Mocks for generateIssuePrompt ---

const mockIssueLabeledPayloadBase: WebhookPayloadIssuesLabeled = {
  action: "labeled",
  issue: {
    // Incomplete Issue object, only necessary fields
    number: 1,
    title: "Test Issue",
    body: "This is the issue body.",
    // ... other issue properties
  },
  repository: {
    // Incomplete Repository object
    id: 123,
    name: "test-repo",
    owner: { login: "test-owner" },
    // ... other repo properties
  },
  label: { name: "aider" }, // Example label
  installation: { id: 1 }, // Example installation
  // ... other payload properties
} as any; // Using 'as any' for brevity, ideally mock the full type

// --- Mocks for generateReviewPrompt ---

const mockReviewSubmittedPayloadBase: WebhookPayloadPullRequestReviewSubmitted =
  {
    action: "submitted",
    review: {
      id: 101,
      node_id: "review-node-id-101",
      user: { login: "reviewer" },
      body: "Overall feedback.",
      state: "changes_requested",
      // ... other review properties
    },
    pull_request: {
      number: 42,
      // ... other PR properties
    },
    repository: {
      id: 123,
      name: "test-repo",
      owner: { login: "test-owner" },
      // ... other repo properties
    },
    installation: { id: 1 }, // Example installation
    // ... other payload properties
  } as any; // Using 'as any' for brevity

// Mock Octokit instance
const mockOctokit = {
  graphql: vi.fn(),
} as unknown as Octokit; // Type assertion for mocking

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
    const prompt = generateIssuePrompt(payload);
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Issue title: Test Issue");
    expect(prompt).toContain("Issue description:\nThis is the issue body.");
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
    const prompt = generateIssuePrompt(payload);
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Issue title: Test Issue No Body");
    expect(prompt).not.toContain("Issue description:");
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
    const prompt = generateIssuePrompt(payload);
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Issue title: Test Issue Empty Body");
    // An empty body results in the description line being added but empty
    expect(prompt).toContain("Issue description:\n");
  });
});

describe("generateReviewPrompt", () => {
  // Reset mocks before each test
  beforeEach(() => {
    vi.resetAllMocks();
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
                id: "review-node-id-1",
                comments: {
                  nodes: [
                    {
                      path: "test.ts",
                      line: 5,
                      startLine: null,
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
    mockOctokit.graphql = vi.fn().mockResolvedValue(mockGraphQLResponse);

    const prompt = await generateReviewPrompt({ octokit: mockOctokit, payload });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Overall review summary:\nOverall feedback.");
    expect(prompt).toContain(
      "Specific comments on files:\n1. file: test.ts; line: 5; comment: Fix this."
    );
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
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
                id: "review-node-id-multi",
                comments: {
                  nodes: [
                    {
                      path: "file.js",
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
    mockOctokit.graphql = vi.fn().mockResolvedValue(mockGraphQLResponse);

    const prompt = await generateReviewPrompt({ octokit: mockOctokit, payload });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Overall review summary:\nMulti-line feedback.");
    expect(prompt).toContain(
      "Specific comments on files:\n1. file: file.js; lines: 10-15; comment: Address this range."
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
                comments: { nodes: [] }, // No comments
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = vi.fn().mockResolvedValue(mockGraphQLResponse);

    const prompt = await generateReviewPrompt({ octokit: mockOctokit, payload });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Overall review summary:\nOverall feedback.");
    expect(prompt).not.toContain("Specific comments on files:");
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
                id: "review-node-id-3",
                comments: {
                  nodes: [
                    {
                      path: "test.ts",
                      line: 5,
                      startLine: null,
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
    mockOctokit.graphql = vi.fn().mockResolvedValue(mockGraphQLResponse);

    const prompt = await generateReviewPrompt({ octokit: mockOctokit, payload });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).not.toContain("Overall review summary:");
    expect(prompt).toContain(
      "Specific comments on files:\n1. file: test.ts; line: 5; comment: Fix this."
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
                id: "review-node-id-4",
                comments: {
                  nodes: [
                    {
                      path: "test.ts",
                      line: 5,
                      startLine: null,
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
    mockOctokit.graphql = vi.fn().mockResolvedValue(mockGraphQLResponse);

    const prompt = await generateReviewPrompt({ octokit: mockOctokit, payload });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    // An empty body results in the summary line being added but empty
    expect(prompt).toContain("Overall review summary:\n");
    expect(prompt).toContain(
      "Specific comments on files:\n1. file: test.ts; line: 5; comment: Fix this."
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
                id: "review-node-id-5",
                comments: { nodes: [] }, // Empty comments array
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = vi.fn().mockResolvedValue(mockGraphQLResponse);

    const prompt = await generateReviewPrompt({ octokit: mockOctokit, payload });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Overall review summary:\nOverall feedback.");
    // Empty comments result in the comments line NOT being added
    expect(prompt).not.toContain("Specific comments on files:");
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
                id: "review-node-id-6",
                comments: { nodes: [] }, // No comments
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = vi.fn().mockResolvedValue(mockGraphQLResponse);

    const prompt = await generateReviewPrompt({ octokit: mockOctokit, payload });
    expect(prompt).toBeNull(); // Expect null when no actionable feedback
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
  });

   it("should return null if the specific review is not found in GraphQL response", async () => {
    const payload = {
      ...mockReviewSubmittedPayloadBase,
      review: {
        ...mockReviewSubmittedPayloadBase.review,
        node_id: "review-node-id-not-found", // This ID won't match
        body: "Some feedback",
      },
    };
    const mockGraphQLResponse: ReviewAndComments = {
      repository: {
        pullRequest: {
          reviews: {
            nodes: [ // Does not contain 'review-node-id-not-found'
              {
                id: "review-node-id-other",
                comments: { nodes: [] },
              },
            ],
          },
        },
      },
    };
    mockOctokit.graphql = vi.fn().mockResolvedValue(mockGraphQLResponse);

    const prompt = await generateReviewPrompt({ octokit: mockOctokit, payload });
    expect(prompt).toBeNull(); // Expect null as the relevant review wasn't found
    expect(mockOctokit.graphql).toHaveBeenCalledTimes(1);
  });

});
