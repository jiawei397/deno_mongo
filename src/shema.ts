import { Hooks, MongoHookCallback, MongoHookMethod } from "./types.ts";
import { getMetadata, TYPE_METADATA_KEY } from "./utils/helper.ts";

export class Schema {
  static preHooks: Hooks = new Map();
  static postHooks: Hooks = new Map();

  static pre(method: MongoHookMethod, callback: MongoHookCallback) {
    return this.hook(this.preHooks, method, callback);
  }
  static post(method: MongoHookMethod, callback: MongoHookCallback) {
    return this.hook(this.postHooks, method, callback);
  }

  static hook(hooks: Hooks, method: MongoHookMethod, callback: MongoHookCallback) {
    let arr = hooks.get(method);
    if (!arr) {
      arr = [];
      hooks.set(method, arr);
    }
    arr.push(callback.bind(this));
    return arr;
  }

  static getMeta() {
    return getMetadata(TYPE_METADATA_KEY, this);
  }

  static getPreHookByMethod(method: MongoHookMethod): MongoHookCallback[] | undefined {
    return this.preHooks.get(method);
  }

  static getPostHookByMethod(method: MongoHookMethod): MongoHookCallback[] | undefined {
    return this.postHooks.get(method);
  }
}

export type SchemaCls = typeof Schema;