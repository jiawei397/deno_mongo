// deno-lint-ignore-file no-explicit-any
import { yellow } from "../../deps.ts";
import { MongoClient } from "../client.ts";
import { Collection } from "../collection/collection.ts";
import { Database } from "../database.ts";
import { getModel, SchemaCls } from "../schema.ts";
import { parse } from "./uri.ts";

let connectedPromise: Promise<any>;
const client = new MongoClient();

export function closeConnection() {
  return client.close();
}

export function getDB(db: string): Promise<Database> {
  if (!connectedPromise) {
    connectedPromise = client.connect(db).then(() => {
      console.info(`connected mongo：${yellow(db)}`);
      return parse(db.split("?")[0]);
    }).then((options) => {
      console.info(`connected mongo db：${yellow(options.db)}`);
      return client.database(options.db);
    });
  }
  return connectedPromise;
}

export class BaseService {
  protected model: Collection<any> | undefined;

  constructor(db: Database, modelCls: SchemaCls, name?: string) {
    getModel(db, modelCls, name).then((model) => {
      this.model = model;
    });
  }
}

export function pick(obj: any, keys: string[]) {
  const result: any = {};
  for (const key of keys) {
    result[key] = obj[key];
  }
  return result;
}
