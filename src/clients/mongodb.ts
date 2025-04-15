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
    { $set: { installationId, renewalDate, pullRequests: [] } },
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

  // Upsert the installation usage record
  await collection.updateOne(
    { installationId, renewalDate },
    {
      $set: { pull_requests: [newPr] },
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

  const pr = installation.pullRequests?.find((pr) => pr.number === prNumber);
  const session = {
    timestamp: new Date(),
    cost: sessionCost,
  };
  pr?.sessions.push(session);

  // Add session to the PR and update total cost
  await collection.updateOne(
    {
      installationId,
      renewalDate,
    },
    {
      $set: { pullRequests: installation.pullRequests },
    }
  );
}
