import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openAIClient = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://yakrware.com",
    "X-Title": "AI Jr Dev",
  },
});

const MODEL_NAME = "google/gemini-2.5-flash-preview"; // Updated model name based on availability

/**
 * Extracts the cost information from the job output log.
 *
 * @param jobOutput The output/logs from the job run.
 * @returns A promise resolving to the extracted cost as a number.
 */
export async function extractSessionCost(jobOutput: string): Promise<number> {
  try {
    // Regex to find the LAST occurrence of the specific cost format
    // Looks for "Cost: $X.X message, $Y.Y session."
    // Captures the session cost (Y)
    const costPattern =
      /Cost: \$\d+\.\d+ message, \$(\d+(?:\.\d+)?) session(?!session)/g;
    const match = costPattern.exec(jobOutput);

    if (match && match[1]) {
      return parseFloat(match[1]);
    }

    // If regex fails, use AI to extract the cost
    console.warn(
      "Regex failed to find cost pattern. Falling back to AI extraction."
    );
    const completion = await openAIClient.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        {
          role: "system",
          content: `You are a cost extraction assistant. Extract ONLY the numeric session cost (the second number) from the LAST occurrence of a line matching the format "Cost: $X.X message, $Y.Y session." in the provided log.
          For example, if the log contains:
          "Cost: $0.0085 message, $0.01 session."
          "Cost: $0.0090 message, $0.02 session."
          You should extract "0.02".
          Return ONLY the numeric value (e.g., "0.02"). If no matching line is found, return "0".`,
        },
        {
          role: "user",
          content: `Job Output Log:\n---\n${jobOutput}\n---`,
        },
      ],
      temperature: 0.1, // Low temperature for factual extraction
      max_tokens: 10, // Very short response needed
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      return 0;
    }

    // Parse the extracted cost as a float
    const extractedCost = parseFloat(content);
    return isNaN(extractedCost) ? 0 : extractedCost;
  } catch (error) {
    console.error("Error extracting session cost:", error);
    return 0; // Default to zero on error
  }
}

/**
 * Analyzes the initial prompt and the output of a failed job run
 * to identify file paths that were requested but potentially missing.
 *
 * @param initialPrompt The original request prompt given to the first job.
 * @param jobOutput The output/logs from the first job run.
 * @returns A promise resolving to an array of potential missing file paths.
 */
export async function identifyMissingFiles(
  initialPrompt: string,
  jobOutput: string
): Promise<string[]> {
  try {
    const completion = await openAIClient.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        {
          role: "system",
          content: `You are an expert code assistant. Analyze the user's request and the output from a previous attempt to fulfill it. The previous attempt failed to make any changes. Identify any specific file paths mentioned in the user's request that seem necessary for the task but might have been missing or inaccessible during the first attempt. Look for explicit mentions of file paths in the user request. Compare this with the job output to see if those files were processed or reported as missing. List *only* the suspected missing file paths, one per line. If no specific files seem to be missing based on the request and output, return an empty response. Do not add any explanation or commentary, only the file paths.`,
        },
        {
          role: "user",
          content: `User Request:\n---\n${initialPrompt}\n---\n\nJob Output Log:\n---\n${jobOutput}\n---`,
        },
      ],
      temperature: 0.1, // Low temperature for factual extraction
      max_tokens: 100, // Limit response size
    });

    const content = completion.choices[0]?.message?.content;
    console.log(`File Search Content: ${content}`);
    if (!content) {
      return [];
    }

    // Split by newline, trim whitespace, and filter out empty lines
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    console.error(
      "Error calling OpenRouter API for identifyMissingFiles:",
      error
    );
    // Decide if we want to throw or just return empty list
    return []; // Return empty list on error to avoid breaking the flow
  }
}

/**
 * Generates a pull request description based on the job output log.
 *
 * @param jobOutput The output/logs from the job run.
 * @returns A promise resolving to a string containing the PR description.
 */
export async function generatePrDescription(
  jobOutput: string
): Promise<string> {
  const defaultDescription =
    "AI-generated changes. Description generation failed or log was unclear.";
  try {
    const completion = await openAIClient.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        {
          role: "system",
          content: `You are an expert technical writer. Analyze the following job output log which contains details of code changes made by an AI assistant. Generate a summary of the changes made, suitable for a pull request description. Use simple, layman's terms. Do NOT include any code snippets, file paths, or overly technical jargon. Focus on *what* was changed and *why* based on the log. If the log indicates no changes were made or is unclear, state that clearly.`,
        },
        {
          role: "user",
          content: `Job Output Log:\n---\n${jobOutput}\n---`,
        },
      ],
      temperature: 0.5, // Moderate temperature for creative summarization
      max_tokens: 300, // Allow longer description
    });

    const content = completion.choices[0]?.message?.content?.trim();
    return content || defaultDescription; // Return generated content or default if empty
  } catch (error) {
    console.error(
      "Error calling OpenRouter API for generatePrDescription:",
      error
    );
    return defaultDescription; // Return default description on error
  }
}

/**
 * Generates a friendly acknowledgement message for the initial comment on an issue.
 * 
 * @returns A promise resolving to a string containing the acknowledgement message.
 */
export async function generateAcknowledgementMessage(): Promise<string> {
  const defaultMessage = "I'm on it!";
  try {
    const completion = await openAIClient.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        {
          role: "system",
          content: `You are an AI junior developer assistant. Generate a friendly, brief acknowledgement message that you'll be working on a GitHub issue. The message should be enthusiastic, professional, and indicate that you're starting to work on the task. Keep it under 3 sentences. Don't ask questions or request clarification - just acknowledge you're working on it. Vary your responses to sound natural.`,
        },
      ],
      temperature: 0.7, // Higher temperature for more variety
      max_tokens: 100, // Keep it brief
    });

    const content = completion.choices[0]?.message?.content?.trim();
    return content || defaultMessage; // Return generated content or default if empty
  } catch (error) {
    console.error(
      "Error calling OpenRouter API for generateAcknowledgementMessage:",
      error
    );
    return defaultMessage; // Return default message on error
  }
}
