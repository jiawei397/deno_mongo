import { assert } from "../test.deps.ts";
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

  Deno.test("testconnect With Options", async () => {
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
}
