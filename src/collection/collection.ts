import { blue, Bson, yellow } from "../../deps.ts";
import { WireProtocol } from "../protocol/mod.ts";
import { SchemaCls } from "../schema.ts";
import {
  CountOptions,
  CreateIndexOptions,
  DeleteOptions,
  DistinctOptions,
  Document,
  DropOptions,
  FindOptions,
  InsertOptions,
  MongoHookMethod,
  SchemaType,
  UpdateOptions,
} from "../types.ts";
import { AggregateCursor } from "./commands/aggregate.ts";
import { FindCursor } from "./commands/find.ts";
import { ListIndexesCursor } from "./commands/listIndexes.ts";
import { update } from "./commands/update.ts";

export class Collection<T> {
  #protocol: WireProtocol;
  #dbName: string;
  #schema: SchemaCls | undefined;

  constructor(
    protocol: WireProtocol,
    dbName: string,
    readonly name: string,
    schema?: SchemaCls,
  ) {
    this.#protocol = protocol;
    this.#dbName = dbName;
    this.#schema = schema;
  }

  private find(filter?: Document, options?: FindOptions): FindCursor<T> {
    let others = {};
    if (options) {
      // deno-lint-ignore no-unused-vars
      const { remainOriginId, ..._others } = options; // must drop it otherwise will call error
      others = _others;
    }
    const res = new FindCursor<T>({
      filter,
      protocol: this.#protocol,
      collectionName: this.name,
      dbName: this.#dbName,
      options: others,
    });
    if (options?.skip) {
      res.skip(options.skip);
    }
    if (options?.limit) {
      res.limit(options.limit);
    }
    if (options?.sort) {
      res.sort(options.sort);
    }
    return res;
  }

  private async preFind(hookType: MongoHookMethod, filter?: Document, options?: FindOptions) {
    this.formatBsonId(filter);
    await this.preHooks(hookType, filter, options);
  }

  private async afterFind(
    docs: unknown | unknown[],
    filter?: Document,
    options?: FindOptions,
  ) {
    if (Array.isArray(docs)) {
      await this.postHooks(MongoHookMethod.findMany, docs, filter, options);
      docs.forEach((doc) => this.formatFindDoc(doc, options?.remainOriginId));
    } else {
      await this.postHooks(MongoHookMethod.findOne, docs, filter, options);
      this.formatFindDoc(docs, options?.remainOriginId);
    }
  }

  async findOne(
    filter?: Document,
    options?: FindOptions,
  ): Promise<T | undefined> {
    await this.preFind(MongoHookMethod.findOne, filter, options);
    const cursor = this.find(filter, options);
    const doc = await cursor.next();
    await this.afterFind(doc, filter, options);
    return doc;
  }

  async findMany(
    filter?: Document,
    options?: FindOptions,
  ): Promise<T[]> {
    await this.preFind(MongoHookMethod.findMany, filter, options);
    const docs = await this.find(filter, options).toArray();
    await this.afterFind(docs, filter, options);
    return docs;
  }

  private formatFindDoc(doc: any, remainOriginId?: boolean) {
    if (!doc) {
      return;
    }
    if (!doc.id) {
      doc.id = doc._id.toString();
      if (!remainOriginId) {
        delete doc._id;
      }
    }
  }

  private formatBsonId(filter?: Document) {
    if (filter) {
      if (filter?._id) {
        const id = filter._id;
        if (typeof id === "string") {
          filter._id = new Bson.ObjectID(id);
        } else if (Array.isArray(id.$in)) {
          id.$in = id.$in.map((_id: any) => {
            if (typeof _id === "string") {
              return new Bson.ObjectID(_id);
            }
          });
        }
      }
    }
  }

  async count(filter?: Document, options?: CountOptions): Promise<number> {
    this.formatBsonId(filter);
    const res = await this.#protocol.commandSingle(this.#dbName, {
      count: this.name,
      query: filter,
      ...options,
    });
    const { n, ok } = res;
    if (ok === 1) {
      return n;
    } else {
      return 0;
    }
  }

  async insertOne(doc: Document, options?: InsertOptions) {
    const { insertedIds } = await this.insertMany([doc], options);
    return insertedIds[0];
  }

  insert(docs: Document | Document[], options?: InsertOptions) {
    docs = Array.isArray(docs) ? docs : [docs];
    return this.insertMany(docs as Document[], options);
  }

  save = this.insert;

  private async preHooks(hook: MongoHookMethod, ...args: any[]) {
    if (!this.#schema) {
      return;
    }

    const fns = this.#schema.getPreHookByMethod(hook);
    if (fns) {
      await Promise.all(fns.map((fn) => fn(...args)));
    }
  }

  private async postHooks(hook: MongoHookMethod, ...args: any[]) {
    if (!this.#schema) {
      return;
    }
    const fns = this.#schema.getPostHookByMethod(hook);
    if (fns) {
      await Promise.all(fns.map((fn) => fn(...args)));
    }
  }

  // check before insert
  private async preInsert(docs: Document[]) {
    if (!this.#schema) {
      return;
    }

    await this.preHooks(MongoHookMethod.create, docs);

    const data = this.#schema.getMeta();
    for (const key in data) {
      const val: SchemaType = data[key];
      docs.forEach((doc) => {
        for (const dk in doc) {
          if (!data.hasOwnProperty(dk) && dk !== '_id') {
            console.warn(yellow(`remove undefined key [${blue(dk)}] in Schema`));
            delete doc[dk];
          }
        }
        if (doc[key] === undefined && val.default !== undefined) {
          if (typeof val.default === "function") {
            if (val.default === Date.now) { // means to get a new Date
              doc[key] = new Date();
            } else {
              doc[key] = val.default();
            }
          } else {
            doc[key] = val.default;
          }
        }
        if (val.required) {
          if (doc[key] == null) {
            if (Array.isArray(val.required)) {
              if (val.required[0]) {
                throw new Error(val.required[1]);
              }
            } else {
              throw new Error(`${key} is required!`);
            }
          }
        }
        if (val.validate) {
          const result = val.validate.validator(doc[key]);
          if (!result) {
            throw new Error(val.validate.message);
          }
        }
      });
    }
  }

  private async afterInsert(docs: Document[]) {
    await this.postHooks(MongoHookMethod.create, docs);
  }

  async insertMany(
    docs: Document[],
    options?: InsertOptions,
  ): Promise<{ insertedIds: Document[]; insertedCount: number }> {
    const insertedIds = docs.map((doc) => {
      if (!doc._id) {
        doc._id = new Bson.ObjectID();
      }
      return doc._id;
    });

    await this.preInsert(docs);

    const res = await this.#protocol.commandSingle(this.#dbName, {
      insert: this.name,
      documents: docs,
      ordered: options?.ordered ?? true,
      writeConcern: options?.writeConcern,
      bypassDocumentValidation: options?.bypassDocumentValidation,
      comment: options?.comment,
    });
    const { writeErrors } = res;
    if (writeErrors) {
      const [{ errmsg }] = writeErrors;
      throw new Error(errmsg);
    }
    await this.afterInsert(docs);
    return {
      insertedIds,
      insertedCount: res.n,
    };
  }

  private async preFindOneAndUpdate(
    filter: Document,
    update: Document,
    options?: UpdateOptions,
  ) {
    this.formatBsonId(filter);
    await this.preHooks(
      MongoHookMethod.findOneAndUpdate,
      filter,
      update,
      options,
    );
  }

  private async afterFindOneAndUpdate(
    doc?: Document,
  ) {
    await this.postHooks(MongoHookMethod.findOneAndUpdate, doc);
  }

  findByIdAndUpdate(
    id: string,
    update: Document,
    options?: UpdateOptions,
  ) {
    const filter = {
      _id: new Bson.ObjectID(id),
    };
    return this.findOneAndUpdate(filter, update, options);
  }

  findById(
    id: string,
    options?: FindOptions,
  ) {
    const filter = {
      _id: new Bson.ObjectID(id),
    };
    return this.findOne(filter, options);
  }

  async findOneAndUpdate(
    filter: Document,
    update: Document,
    options?: UpdateOptions,
  ) {
    await this.preFindOneAndUpdate(filter, update, options);
    const res = await this.updateOne(filter, update, options);
    if (options?.new) {
      if (res.matchedCount > 0) {
        const updatedDoc = await this.findOne(filter);
        await this.afterFindOneAndUpdate(updatedDoc);
        return updatedDoc;
      } else {
        return null;
      }
    }
    return res;
  }

  async updateOne(filter: Document, update: Document, options?: UpdateOptions) {
    const {
      upsertedIds = [],
      upsertedCount,
      matchedCount,
      modifiedCount,
    } = await this.updateMany(filter, update, {
      ...options,
      multi: false,
    });
    return {
      upsertedId: upsertedIds ? upsertedIds[0] : undefined,
      upsertedCount,
      matchedCount,
      modifiedCount,
    };
  }

  private async preUpdate(
    filter: Document,
    doc: Document,
    options?: UpdateOptions,
  ) {
    this.formatBsonId(filter);

    if (this.#schema) {
      const data = this.#schema.getMeta();
      const removeKey = (doc: any) => {
        for (const dk in doc) {
          if (!doc.hasOwnProperty(dk)) {
            continue;
          }
          if (dk.startsWith('$')) { // mean is mongo query
            removeKey(doc[dk]);
          } else {
            if (!data.hasOwnProperty(dk)) {
              console.warn(yellow(`remove undefined key [${blue(dk)}] in Schema`));
              delete doc[dk];
            }
          }
        }
      }
      removeKey(doc);
    }
    await this.preHooks(MongoHookMethod.update, filter, doc, options);
  }

  private async afterUpdate(
    filter: Document,
    doc: Document,
    options?: UpdateOptions,
  ) {
    await this.postHooks(MongoHookMethod.update, filter, doc, options);
  }

  async updateMany(filter: Document, doc: Document, options?: UpdateOptions) {
    await this.preUpdate(filter, doc, options);
    const res = await update(
      this.#protocol,
      this.#dbName,
      this.name,
      filter,
      doc,
      {
        ...options,
        multi: options?.multi ?? true,
      },
    );
    await this.afterUpdate(filter, doc, options);
    return res;
  }

  private async preDelete(
    filter: Document,
    options?: DeleteOptions,
  ) {
    this.formatBsonId(filter);
    await this.preHooks(MongoHookMethod.delete, filter, options);
  }

  private async afterDelete(
    filter: Document,
    options?: DeleteOptions,
    res?: Bson.Document,
  ) {
    await this.postHooks(MongoHookMethod.delete, filter, options, res);
  }

  async deleteMany(filter: Document, options?: DeleteOptions): Promise<number> {
    await this.preDelete(filter, options);
    const res = await this.#protocol.commandSingle(this.#dbName, {
      delete: this.name,
      deletes: [
        {
          q: filter,
          limit: options?.limit ?? 0,
          collation: options?.collation,
          hint: options?.hint,
          comment: options?.comment,
        },
      ],
      ordered: options?.ordered ?? true,
      writeConcern: options?.writeConcern,
    });
    await this.afterDelete(filter, options, res);
    return res.n;
  }

  delete = this.deleteMany;

  deleteOne(filter: Document, options?: DeleteOptions) {
    return this.delete(filter, { ...options, limit: 1 });
  }

  findOneAndDelete = this.deleteOne;

  deleteById(id: string) {
    const filter = {
      _id: new Bson.ObjectID(id),
    };
    return this.deleteOne(filter);
  }

  async drop(options?: DropOptions): Promise<void> {
    await this.#protocol.commandSingle(this.#dbName, {
      drop: this.name,
      ...options,
    });
  }

  async distinct(key: string, query?: Document, options?: DistinctOptions) {
    const { values } = await this.#protocol.commandSingle(this.#dbName, {
      distinct: this.name,
      key,
      query,
      ...options,
    });
    return values;
  }

  aggregate(pipeline: Document[], options?: any): AggregateCursor<T> {
    return new AggregateCursor<T>({
      pipeline,
      protocol: this.#protocol,
      dbName: this.#dbName,
      collectionName: this.name,
      options,
    });
  }

  async createIndexes(options: CreateIndexOptions) {
    const res = await this.#protocol.commandSingle<{
      ok: number;
      createdCollectionAutomatically: boolean;
      numIndexesBefore: number;
      numIndexesAfter: number;
    }>(this.#dbName, {
      createIndexes: this.name,
      ...options,
    });
    return res;
  }

  listIndexes() {
    return new ListIndexesCursor<
      { v: number; key: Document; name: string; ns: string }
    >({
      protocol: this.#protocol,
      dbName: this.#dbName,
      collectionName: this.name,
    });
  }
}
