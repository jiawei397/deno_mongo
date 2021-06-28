import { yellow } from "../../deps.ts";
import { MongoClient } from "../client.ts";
import { Collection } from "../collection/collection.ts";
import { Database } from "../database.ts";
import { SchemaCls } from "../schema.ts";
import { Constructor } from "../types.ts";

export const TYPE_METADATA_KEY = "design:type";

let connectedPromise: Promise<any>;
const client = new MongoClient();
const modelCaches = new Map();

export function getDB(db: string): Promise<Database> {
  if (!connectedPromise) {
    const arr = db.split("/");
    if (db.endsWith("/")) {
      arr.pop();
    }
    const dbName = arr.pop();
    const url = arr.join("/");
    connectedPromise = client.connect(url).then(() => {
      console.info(`连接到mongo：${yellow(url)}`);
      return client.database(dbName!);
    });
  }
  return connectedPromise;
}

function getModelByName(cls: Constructor, name?: string) {
  let modelName = name || cls.name;
  if (!modelName.endsWith("s")) {
    modelName += "s";
  }
  return modelName.toLowerCase();
}

export async function getModel<T>(
  db: Database,
  cls: SchemaCls,
  name?: string,
): Promise<Collection<T>> {
  if (modelCaches.has(cls)) {
    return modelCaches.get(cls);
  }
  const modelName = getModelByName(cls, name);
  const model = db.collection<T>(modelName, cls);
  modelCaches.set(cls, model);
  await initModel<T>(model, cls);
  console.log(`model [${modelName}] init ok`);
  return model;
}

export async function initModel<T>(model: Collection<T>, cls: SchemaCls) {
  const data = getMetadata(
    TYPE_METADATA_KEY,
    cls,
  );
  const indexes = [];
  for (const key in data) {
    const map = data[key];
    if (Object.keys(map).length === 0) {
      continue;
    }
    if (map.unique === undefined) {
      continue;
    }
    indexes.push({
      name: "_" + key,
      key: { [key]: 1 },
      ...map,
    });
  }

  if (indexes.length === 0) {
    return;
  }
  await model.createIndexes({
    indexes,
  });
}

type Target = Constructor & {
  [x: string]: any;
};

type TargetInstance = any;

export interface SchemaType {
  unique?: boolean;
  required?: boolean;
}

function addMetadata(
  key: string,
  target: TargetInstance, // 实例
  propertyKey: string,
  props: any = {},
) {
  // 这里target是实例
  if (!target.constructor[key]) {
    target.constructor[key] = {};
  }
  target.constructor[key][propertyKey] = props;
}

export function getMetadata(
  key: string,
  target: Target,
  propertyKey?: string,
) {
  return propertyKey ? target[key]?.[propertyKey] : target[key];
}

export function Prop(props?: SchemaType) {
  return function (target: TargetInstance, propertyKey: string) {
    addMetadata(TYPE_METADATA_KEY, target, propertyKey, props);
    return target;
  };
}

export class BaseService {
  protected model: Collection<any> | undefined;

  constructor(db: Database, modelCls: SchemaCls, name?: string) {
    getModel(db, modelCls, name).then((model) => {
      this.model = model;
    });
  }
}

export function logTime(
  target: Constructor,
  name: string,
  descriptor: any,
) {
  const oldValue = descriptor.value;
  descriptor.value = async function () {
    const start = Date.now();
    const result = await oldValue.apply(this, arguments);
    const time = Date.now() - start;
    console.log(`方法${name}耗时${time}ms`);
    return result;
  };
  return descriptor;
}
