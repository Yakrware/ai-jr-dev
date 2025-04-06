export type ReviewAndComments = {
  repository: {
    pullRequest: {
      reviews: {
        nodes: {
          id: string;
          bodyText: string;
          comments: {
            nodes: {
              id: string;
              bodyText: string;
              startLine: number | undefined;
              line: number | undefined;
              path: string;
            }[];
          };
        }[];
      };
    };
  };
};

export const reviewAndComments = `
query ($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviews(last: 5) {
        nodes {
          id
          bodyText
          comments(first: 100) {
            nodes {
              id
              bodyText
              startLine
              line
              path
            }
          }
        }
      }
    }
  }
}`;
