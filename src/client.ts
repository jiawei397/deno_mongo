import { Database } from "./database.ts";
import { ConnectOptions, Document, ListDatabaseInfo } from "./types.ts";
import { parse } from "./utils/uri.ts";
import { MongoError } from "./error.ts";
import { Cluster } from "./cluster.ts";
import { assert } from "../deps.ts";

const DENO_DRIVER_VERSION = "0.0.1";

export class MongoClient {
  #cluster?: Cluster;

  // cache db
  #dbCache = new Map();

  #connectionCache = new Map();

  connectDB(
    options: ConnectOptions,
  ): Promise<Database> {
    const cacheKey = JSON.stringify(options.servers);
    if (!options.multi) { // singleton
      if (this.#connectionCache.has(cacheKey)) {
        return this.#connectionCache.get(cacheKey);
      }
    }
    console.count("connectDB");
    let cluster: Cluster;
    const promise = Promise.resolve().then(() => {
      cluster = new Cluster(options);
      return cluster.connect();
    }).then(() => {
      return cluster.authenticate();
    }).then(() => {
      return cluster.updateMaster();
    }).then(() => {
      this.#cluster = cluster;
      return this.database(options.db);
    });
    if (!options.multi) {
      this.#connectionCache.set(cacheKey, promise);
    }
    return promise;
  }

  async connect(
    options: ConnectOptions | string,
  ): Promise<Database> {
    try {
      const parsedOptions = typeof options === "string"
        ? await parse(options)
        : options;
      return await this.connectDB(parsedOptions);
    } catch (e) {
      throw new MongoError(`Connection failed: ${e.message || e}`);
    }
  }

  async listDatabases(options?: {
    filter?: Document;
    nameOnly?: boolean;
    authorizedCollections?: boolean;
    comment?: Document;
  }): Promise<ListDatabaseInfo[]> {
    if (!options) {
      options = {};
    }
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

  database(name: string): Database {
    assert(this.#cluster);
    if (this.#dbCache.has(name)) {
      return this.#dbCache.get(name);
    }
    const db = new Database(this.#cluster, name);
    this.#dbCache.set(name, db);
    return db;
  }

  close() {
    if (this.#cluster) this.#cluster.close();
    this.#dbCache.clear();
  }

  get version() {
    return DENO_DRIVER_VERSION;
  }
}
