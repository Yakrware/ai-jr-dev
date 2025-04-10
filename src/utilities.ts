export const kebabCase = (sentence: string) => {
  return sentence
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
};
