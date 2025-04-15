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
): Promise<Installation | null> {
  await client.connect();
  const db = client.db();
  const collection = db.collection<Installation>("installations");

  const installation = await collection.findOneAndUpdate(
    {
      installationId,
      renewalDate,
    },
    { $set: { installationId, renewalDate, pullRequests: [] } },
    {
      upsert: true,
      returnDocument: "after",
    }
  );

  return installation as Installation | null;
}

/**
 * Adds a new pull request to the installation's usage record
 */
export async function addPullRequestToUsage(
  installationId: number,
  prNumber: number,
  initialCost: number = 0
): Promise<void> {
  await client.connect();
  const db = client.db();
  const collection = db.collection<Installation>("installations");

  // Create new PR record
  const newPr: PullRequest = {
    number: prNumber,
    created_at: new Date(),
    cost: initialCost,
    sessions: [],
  };

  // Upsert the installation usage record
  await collection.updateOne(
    { installation_id: installationId },
    {
      $setOnInsert: { installation_id: installationId },
      $push: { pull_requests: newPr },
    },
    { upsert: true }
  );
}

/**
 * Adds a new session to an existing pull request
 */
export async function addSessionToPullRequest(
  installationId: number,
  prNumber: number,
  sessionCost: number
): Promise<void> {
  await client.connect();
  const db = client.db();
  const collection = db.collection<Installation>("installations");

  const session = {
    timestamp: new Date(),
    cost: sessionCost,
  };

  // Add session to the PR and update total cost
  await collection.updateOne(
    {
      installation_id: installationId,
      "pull_requests.number": prNumber,
    },
    {
      $push: { "pull_requests.$.sessions": session },
      $inc: { "pull_requests.$.cost": sessionCost },
    }
  );
}
