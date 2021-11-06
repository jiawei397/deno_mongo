// deno-lint-ignore-file no-explicit-any
import { green } from "../deps.ts";
import { Collection } from "../mod.ts";
import { Database } from "./database.ts";
import {
  Constructor,
  Hooks,
  MongoHookCallback,
  MongoHookMethod,
  SchemaType,
  Target,
  TargetInstance,
  VirtualType,
  VirtualTypeOptions,
} from "./types.ts";

export const metadataCache = new Map();
let modelCaches: Map<SchemaCls, any> | undefined;
export const TYPE_METADATA_KEY = Symbol("design:type");

export const instanceCache = new Map();

export const virtualCache = new Map();

export class Schema {
  static preHooks: Hooks = new Map();
  static postHooks: Hooks = new Map();

  static pre(method: MongoHookMethod, callback: MongoHookCallback) {
    return this.hook(this.preHooks, method, callback);
  }
  static post(method: MongoHookMethod, callback: MongoHookCallback) {
    return this.hook(this.postHooks, method, callback);
  }

  static hook(
    hooks: Hooks,
    method: MongoHookMethod,
    callback: MongoHookCallback,
  ) {
    let arr = hooks.get(method);
    if (!arr) {
      arr = [];
      hooks.set(method, arr);
    }
    arr.push(callback.bind(this));
    return arr;
  }

  static getMeta() {
    const map = getMetadata(this);
    const baseMap = getMetadata(Schema);
    return {
      ...baseMap,
      ...map,
    };
  }

  static getPreHookByMethod(
    method: MongoHookMethod,
  ): MongoHookCallback[] | undefined {
    return this.preHooks.get(method);
  }

  static getPostHookByMethod(
    method: MongoHookMethod,
  ): MongoHookCallback[] | undefined {
    return this.postHooks.get(method);
  }

  static virtual(name: string, options: VirtualTypeOptions) {
    virtualCache.set(name, options);
    return this;
  }

  @Prop({
    default: Date.now,
  })
  createTime?: Date;

  @Prop({
    default: Date.now,
  })
  modifyTime?: Date;
}

export type SchemaCls = typeof Schema;

export function getInstance(cls: Target) {
  if (instanceCache.has(cls)) {
    return instanceCache.get(cls);
  }
  const instance = new cls();
  instanceCache.set(cls, instance);
  return instance;
}

export function addMetadata(
  target: Target,
  propertyKey: string,
  props: any = {},
) {
  const instance = getInstance(target);
  let map = metadataCache.get(instance);
  if (!map) {
    map = {};
    metadataCache.set(instance, map);
  }
  map[propertyKey] = props;
}

export function getMetadata(
  target: Target,
  propertyKey?: string,
) {
  const map = metadataCache.get(getInstance(target));
  if (propertyKey) {
    return map[propertyKey];
  }
  return map;
}

export function Prop(props?: SchemaType) {
  return function (target: TargetInstance, propertyKey: string) {
    addMetadata(target.constructor, propertyKey, props);
    return target;
  };
}

export function getModelByName(cls: Constructor, name?: string) {
  let modelName = name || cls.name;
  if (!modelName.endsWith("s")) {
    modelName += "s";
  }
  return modelName.toLowerCase();
}

export async function getModel<T extends Schema>(
  db: Database,
  cls: SchemaCls,
  name?: string,
): Promise<Collection<T>> {
  if (!modelCaches) {
    modelCaches = new Map<SchemaCls, Collection<T>>();
  } else {
    if (modelCaches.has(cls)) {
      return modelCaches.get(cls);
    }
  }
  const modelName = getModelByName(cls, name);
  const model = db.collection(modelName, cls);
  modelCaches.set(cls, model);
  await initModel(model, cls);
  console.log(green(`Schema [${modelName}] init ok`));
  return model as Collection<T>;
}

export async function initModel(model: Collection<unknown>, cls: SchemaCls) {
  const data = getMetadata(cls);
  const indexes = [];
  for (const key in data) {
    const map: SchemaType = data[key];
    if (Object.keys(map).length === 0) {
      continue;
    }
    if (!map.index && !map.unique && !map.expires && !map.sparse) {
      continue;
    }
    indexes.push({
      name: key + "_1",
      key: { [key]: 1 },
      unique: map.unique,
      sparse: map.sparse,
      expireAfterSeconds: map.expires,
    });
  }

  if (indexes.length === 0) {
    return;
  }
  await model.createIndexes({
    indexes,
  });
}
