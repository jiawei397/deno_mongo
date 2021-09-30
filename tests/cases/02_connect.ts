import { assert, assertEquals } from "../test.deps.ts";
import { MongoClient } from "../../src/client.ts";

// const hostname = "127.0.0.1";
const hostname = "192.168.21.176";
const port = 27018;

export default function connectTests() {
  Deno.test("test connect", async () => {
    const client = new MongoClient();
    await client.connect(`mongodb://${hostname}:${port}`);
    const names = await client.listDatabases();
    assert(names instanceof Array);
    assert(names.length > 0);
    client.close();
  });

  Deno.test("test singleton connect", async () => {
    const client = new MongoClient();
    const promise1 = client.connect(`mongodb://${hostname}:${port}`);
    const promise2 = client.connect(`mongodb://${hostname}:${port}`);
    await promise1;
    await promise2;
    assert(client.connectedCount == 1, "the same connect is singleton");
    client.close();
  });

  Deno.test("test connect With Options", async () => {
    const client = new MongoClient();
    await client.connect({
      servers: [{ host: hostname, port }],
      db: "admin",
    });
    const names = await client.listDatabases();
    assert(names instanceof Array);
    assert(names.length > 0);
    client.close();
  });

  Deno.test("test default database name from connection options", async () => {
    const client = new MongoClient();
    await client.connect(`mongodb://${hostname}:27017/my-db`);
    const db = client.database();
    assertEquals(db.name, "my-db");
    client.close();
  });
}
