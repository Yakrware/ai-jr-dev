import { Hono } from "hono";
import { App, Octokit } from "octokit";
import { createWebMiddleware } from "@octokit/webhooks";

type Variables = {
  octokit: Octokit;
};

const app = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

app.use(async (context, next) => {
  const octoApp = new App({
    appId: context.env.APP_ID,
    privateKey: context.env.PRIVATE_KEY,
    webhooks: {
      secret: context.env.WEBHOOK_SECRET,
    },
  });

  octoApp.webhooks.on("issues.labeled", async ({ payload, octokit }) => {
    if (payload.label?.name === "aider") {
      await octokit.rest.issues.createComment({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.issue.number,
        body: "I'm on it!",
      });

      // TODO: Make all of this happen in a isolated image
      // clone temp repo
      // checkout branch
      // launch aider
      // push changes
      // clean up temp repo
      // create PR
    }
  });

  octoApp.webhooks.on(
    "pull_request_review.submitted",
    async ({ payload, octokit }) => {
      if (
        payload.pull_request.user?.id === Number(context.env.APP_ID) &&
        payload.review.state === "changes_requested"
      ) {
        console.log("Responding to review");
        // clone temp repo
        // checkout branch
        // launch aider
        // push changes
        // clean up temp repo
        // dismiss/reset review
      }
    }
  );

  const middleware = createWebMiddleware(octoApp.webhooks, { path: "/" });
  const resp = await middleware(context.req.raw);

  if (resp.ok) return resp;

  next();
});

app.get("/", (c) => {
  return c.text("ok");
});

export default app;
