import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.DB_URI as string);

export type EnterpriseClient = {
  name: string;
  montlhyLimit: number;
};

export type PullRequest = {
  number: number;
  created_at: Date;
  cost: number;
  sessions: Array<{
    timestamp: Date;
    cost: number;
  }>;
};

export type Installation = {
  installationId: number;
  renewalDate: string;
  pullRequests?: PullRequest[];
};

/**
 * Retrieves enterprise client information by name
 */
export async function getEnterpriseClient(names: string[]) {
  await client.connect();
  return client
    .db()
    .collection("enterpriseAccounts")
    .findOne<EnterpriseClient>(
      { name: { $in: names } },
      { projection: { _id: 0, name: 1, monlthyLimit: 1 } }
    );
}

/**
 * Retrieves usage data for a specific installation
 */
export async function getInstallation(
  installationId: number,
  renewalDate: string
): Promise<Installation> {
  await client.connect();
  const db = client.db();
  const collection = db.collection<Installation>("installations");

  const installation = await collection.findOneAndUpdate(
    {
      installationId,
      renewalDate,
    },
    { $set: { installationId, renewalDate } },
    {
      upsert: true,
      returnDocument: "after",
    }
  );

  return installation as Installation;
}

/**
 * Adds a new pull request to the installation's usage record
 */
export async function addPullRequestToUsage(
  installationId: number,
  renewalDate: string,
  prNumber: number,
  initialCost: number = 0
): Promise<void> {
  await client.connect();
  const db = client.db();
  const collection = db.collection<Installation>("installations");

  const installation = await getInstallation(installationId, renewalDate);

  // Create new PR record
  const newPr: PullRequest = {
    number: prNumber,
    created_at: new Date(),
    cost: initialCost,
    sessions: [
      {
        timestamp: new Date(),
        cost: initialCost,
      },
    ],
  };

  const prs = installation.pullRequests || [];
  prs.push(newPr);

  // Upsert the installation usage record
  await collection.updateOne(
    { installationId, renewalDate },
    {
      $set: { pullRequests: prs },
    }
  );
}

/**
 * Adds a new session to an existing pull request
 */
export async function addSessionToPullRequest(
  installationId: number,
  renewalDate: string,
  prNumber: number,
  sessionCost: number
): Promise<void> {
  await client.connect();
  const db = client.db();
  const collection = db.collection<Installation>("installations");

  const installation = await getInstallation(installationId, renewalDate);
  if (!installation.pullRequests) installation.pullRequests = [];
  console.log(JSON.stringify(installation));

  let pr = installation.pullRequests.find((pr) => pr.number === prNumber);
  if (!pr) {
    pr = {
      number: prNumber,
      created_at: new Date(),
      cost: sessionCost,
      sessions: [],
    };
    installation.pullRequests.push(pr);
  }
  const session = {
    timestamp: new Date(),
    cost: sessionCost,
  };
  pr.sessions.push(session);
  console.log(JSON.stringify(installation));

  // Add session to the PR and update total cost
  await collection.updateOne(
    {
      installationId,
      renewalDate,
    },
    {
      $set: { pullRequests: installation.pullRequests },
      $inc: { cost: sessionCost },
    }
  );
}

/**
 * Gets the total count of users in the promotion collection.
 */
export async function getPromotionCount(): Promise<number> {
  await client.connect();
  const db = client.db();
  const collection = db.collection("promotionUsers"); // Assuming collection name
  return collection.countDocuments();
}

/**
 * Finds a user in the promotion collection by ownerLogin.
 */
export async function findPromotionUser(ownerLogin: string) {
  await client.connect();
  const db = client.db();
  const collection = db.collection("promotionUsers"); // Assuming collection name
  return collection.findOne({ ownerLogin: ownerLogin });
}

/**
 * Adds a user to the promotion collection if they don't already exist.
 * Returns the result of the findOneAndUpdate operation.
 */
export async function addPromotionUser(ownerLogin: string) {
  await client.connect();
  const db = client.db();
  const collection = db.collection("promotionUsers"); // Assuming collection name

  // Use findOneAndUpdate with upsert: true
  // $setOnInsert ensures fields are only set during insertion
  const result = await collection.findOneAndUpdate(
    { ownerLogin: ownerLogin },
    { $setOnInsert: { ownerLogin: ownerLogin, addedAt: new Date() } },
    { upsert: true, returnDocument: "after" } // returnDocument option might not be strictly needed here but is good practice
  );

  return result; // Return the full result object which contains matchedCount, upsertedCount etc.
}
