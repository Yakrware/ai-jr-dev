import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openAIClient = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL_NAME = "openrouter/google/gemini-2.0-flash-001"; // Updated model name based on availability

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
    if (!content) {
      return [];
    }

    // Split by newline, trim whitespace, and filter out empty lines
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    console.error("Error calling OpenRouter API:", error);
    // Decide if we want to throw or just return empty list
    return []; // Return empty list on error to avoid breaking the flow
  }
}
