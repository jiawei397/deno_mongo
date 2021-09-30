// deno-lint-ignore-file no-explicit-any
import { Database } from "./database.ts";
import {
  BuildInfo,
  ConnectOptions,
  Document,
  ListDatabaseInfo,
} from "./types.ts";
import { parse } from "./utils/uri.ts";
import { MongoDriverError } from "./error.ts";
import { Cluster } from "./cluster.ts";
import { assert } from "../deps.ts";

export class MongoClient {
  #cluster?: Cluster;
  #defaultDbName = "admin";
  #buildInfo?: BuildInfo;

  get buildInfo() {
    return this.#buildInfo;
  }

  // cache db
  #dbCache = new Map();

  #connectionCache = new Map();

  public connectedCount = 0;

  async connectDB(
    options: ConnectOptions,
  ): Promise<Database> {
    this.#defaultDbName = options.db;
    const cluster = new Cluster(options);
    await cluster.connect();
    await cluster.authenticate();
    await cluster.updateMaster();

    this.#cluster = cluster;
    this.#buildInfo = await this.runCommand(this.#defaultDbName, {
      buildInfo: 1,
    });
    return this.database(options.db);
  }

  async connect(
    options: ConnectOptions | string,
  ): Promise<Database> {
    try {
      const parsedOptions = typeof options === "string"
        ? await parse(options)
        : options;
      const cacheKey = JSON.stringify(parsedOptions.servers);
      if (this.#connectionCache.has(cacheKey)) {
        return this.#connectionCache.get(cacheKey);
      }
      const promise = this.connectDB(parsedOptions);
      this.connectedCount++;
      this.#connectionCache.set(cacheKey, promise);
      return promise;
    } catch (e) {
      throw new MongoDriverError(`Connection failed: ${e.message || e}`);
    }
  }

  async listDatabases(options: {
    filter?: Document;
    nameOnly?: boolean;
    authorizedCollections?: boolean;
    comment?: Document;
  } = {}): Promise<ListDatabaseInfo[]> {
    assert(this.#cluster);
    const { databases } = await this.#cluster.protocol.commandSingle("admin", {
      listDatabases: 1,
      ...options,
    });
    return databases;
  }

  // TODO: add test cases
  async runCommand<T = any>(db: string, body: Document): Promise<T> {
    assert(this.#cluster);
    return await this.#cluster.protocol.commandSingle(db, body);
  }

  database(name = this.#defaultDbName): Database {
    assert(this.#cluster);
    if (this.#dbCache.has(name)) {
      return this.#dbCache.get(name);
    }
    const db = new Database(this.#cluster, name);
    this.#dbCache.set(name, db);
    return db;
  }

  close() {
    if (this.#cluster) {
      this.#cluster.close();
    }
    this.#dbCache.clear();
    this.#connectionCache.clear();
    this.connectedCount = 0;
  }
}
