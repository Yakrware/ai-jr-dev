// System prompt to guide the AI
const SYSTEM_PROMPT = `You are an AI assistant acting as a junior software developer. 
Your goal is to implement the requested changes based on the provided context (issue description or review comments).
Apply the changes directly to the codebase.
Ensure your changes are clean, efficient, and follow existing coding conventions.
If you need to add dependencies, use the appropriate package manager commands (e.g., npm install).
If you need to run database migrations or other commands, mention them in the pull request summary.`;

interface IssuePromptParams {
  title: string;
  body: string | null;
}

/**
 * Generates a prompt for handling a new issue.
 * @param params - Issue details.
 * @returns The generated prompt string.
 */
export function generateIssuePrompt({ title, body }: IssuePromptParams): string {
  const description = body ? `\nIssue description:\n${body}` : "";
  const issuePrompt = `Apply all necessary changes based on below issue description. \nIssue title: ${title}${description}`;
  return `${SYSTEM_PROMPT}\n\n${issuePrompt}`;
}

interface ReviewPromptParams {
  reviewBody: string | null;
  comments: string | null; // Formatted comments string
}

/**
 * Generates a prompt for handling review feedback.
 * @param params - Review details.
 * @returns The generated prompt string.
 */
export function generateReviewPrompt({
  reviewBody,
  comments,
}: ReviewPromptParams): string {
  let reviewPrompt = `Apply all necessary changes based on the following review comments.`;
  if (reviewBody) {
    reviewPrompt += `\n\nOverall review summary:\n${reviewBody}`;
  }
  if (comments && comments.length > 0) {
    reviewPrompt += `\n\nSpecific comments on files:\n${comments}`;
  }
  return `${SYSTEM_PROMPT}\n\n${reviewPrompt}`;
}
