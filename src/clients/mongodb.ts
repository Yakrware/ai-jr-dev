import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.DB_URI as string);

export type EnterpriseClient = {
  name: string;
  montlhyLimit: number;
};

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
