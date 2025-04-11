import { generateIssuePrompt, generateReviewPrompt } from "./prompt";
import { describe, it, expect } from "vitest";

// Basic check for the system prompt inclusion
const SYSTEM_PROMPT_CHECK =
  "You are an AI assistant acting as a junior software developer.";

describe("generateIssuePrompt", () => {
  it("should generate a prompt with title and body", () => {
    const prompt = generateIssuePrompt({
      title: "Test Issue",
      body: "This is the issue body.",
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Issue title: Test Issue");
    expect(prompt).toContain("Issue description:\nThis is the issue body.");
  });

  it("should generate a prompt with title only when body is null", () => {
    const prompt = generateIssuePrompt({
      title: "Test Issue No Body",
      body: null,
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Issue title: Test Issue No Body");
    expect(prompt).not.toContain("Issue description:");
  });

  it("should generate a prompt with title only when body is empty string", () => {
    const prompt = generateIssuePrompt({
      title: "Test Issue Empty Body",
      body: "",
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Issue title: Test Issue Empty Body");
    // An empty body results in the description line being added but empty
    expect(prompt).toContain("Issue description:\n");
  });
});

describe("generateReviewPrompt", () => {
  it("should generate a prompt with review body and comments", () => {
    const prompt = generateReviewPrompt({
      reviewBody: "Overall feedback.",
      comments: "1. file: test.ts; line: 5; comment: Fix this.",
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Overall review summary:\nOverall feedback.");
    expect(prompt).toContain(
      "Specific comments on files:\n1. file: test.ts; line: 5; comment: Fix this."
    );
  });

  it("should generate a prompt with review body only", () => {
    const prompt = generateReviewPrompt({
      reviewBody: "Overall feedback.",
      comments: null,
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Overall review summary:\nOverall feedback.");
    expect(prompt).not.toContain("Specific comments on files:");
  });

  it("should generate a prompt with comments only", () => {
    const prompt = generateReviewPrompt({
      reviewBody: null,
      comments: "1. file: test.ts; line: 5; comment: Fix this.",
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).not.toContain("Overall review summary:");
    expect(prompt).toContain(
      "Specific comments on files:\n1. file: test.ts; line: 5; comment: Fix this."
    );
  });

   it("should generate a prompt with comments only when review body is empty string", () => {
    const prompt = generateReviewPrompt({
      reviewBody: "",
      comments: "1. file: test.ts; line: 5; comment: Fix this.",
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    // An empty body results in the summary line being added but empty
    expect(prompt).toContain("Overall review summary:\n");
    expect(prompt).toContain(
      "Specific comments on files:\n1. file: test.ts; line: 5; comment: Fix this."
    );
  });

  it("should generate a prompt with review body only when comments is empty string", () => {
    const prompt = generateReviewPrompt({
      reviewBody: "Overall feedback.",
      comments: "",
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain("Overall review summary:\nOverall feedback.");
    // Empty comments string results in the comments line being added but empty
    expect(prompt).toContain("Specific comments on files:\n");
  });


  it("should generate a prompt even if both body and comments are null", () => {
    // Although the calling code in index.ts prevents this, the function should handle it.
    const prompt = generateReviewPrompt({
      reviewBody: null,
      comments: null,
    });
    expect(prompt).toContain(SYSTEM_PROMPT_CHECK);
    expect(prompt).toContain(
      "Apply all necessary changes based on the following review comments."
    );
    expect(prompt).not.toContain("Overall review summary:");
    expect(prompt).not.toContain("Specific comments on files:");
  });
});
