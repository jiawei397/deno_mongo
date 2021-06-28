import {Bson} from "../../deps.ts";
import {WireProtocol} from "../protocol/mod.ts";
import {SchemaCls} from "../shema.ts";
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
  UpdateOptions,
} from "../types.ts";
import {AggregateCursor} from "./commands/aggregate.ts";
import {FindCursor} from "./commands/find.ts";
import {ListIndexesCursor} from "./commands/listIndexes.ts";
import {update} from "./commands/update.ts";


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

  find(filter?: Document, options?: FindOptions): FindCursor<T> {
    return new FindCursor<T>({
      filter,
      protocol: this.#protocol,
      collectionName: this.name,
      dbName: this.#dbName,
      options: options ?? {},
    });
  }

  async findOne(
      filter?: Document,
      options?: FindOptions,
  ): Promise<T | undefined> {
    const cursor = this.find(filter, options);
    return await cursor.next();
  }

  async count(filter?: Document, options?: CountOptions): Promise<number> {
    const res = await this.#protocol.commandSingle(this.#dbName, {
      count: this.name,
      query: filter,
      ...options,
    });
    const {n, ok} = res;
    if (ok === 1) {
      return n;
    } else {
      return 0;
    }
  }

  async insertOne(doc: Document, options?: InsertOptions) {
    const {insertedIds} = await this.insertMany([doc], options);
    return insertedIds[0];
  }

  async insert(docs: Document | Document[], options?: InsertOptions) {
    docs = Array.isArray(docs) ? docs : [docs];
    return this.insertMany(docs as Document[], options);
  }

  // check before insert
  private async preInsert(docs: Document[]) {
    if (!this.#schema) {
      return;
    }

    const fns = this.#schema.getPreHookByMethod(MongoHookMethod.create);
    if (fns) {
      await Promise.all(fns.map(fn => fn(docs)));
    }

    const data = this.#schema.getMeta();
    for (const key in data) {
      const val = data[key];
      if (val.required) {
        docs.forEach((doc) => {
          if (doc[key] == null) {
            throw new Error(`${key} is required!`);
          }
        });
      }
    }
  }

  private async afterInsert(docs: Document[]) {
    if (!this.#schema) {
      return;
    }
    const fns = this.#schema.getPostHookByMethod(MongoHookMethod.create);
    if (fns) {
      await Promise.all(fns.map(fn => fn(docs)));
    }
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
    const {writeErrors} = res;
    if (writeErrors) {
      const [{errmsg}] = writeErrors;
      throw new Error(errmsg);
    }
    await this.afterInsert(docs);
    return {
      insertedIds,
      insertedCount: res.n,
    };
  }

  async findByIdAndUpdate(id: string, update: Document, options?: UpdateOptions) {
    const filter = {
      _id: new Bson.ObjectID(id)
    };
    return this.findOneAndUpdate(filter, update, options);
  }

  async findOneAndUpdate(filter: Document, update: Document, options?: UpdateOptions) {
    const res = await this.updateOne(filter, update, options);
    if (options?.new) {
      if (res.matchedCount > 0) {
        return this.findOne(filter);
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

  private async preUpdate(filter: Document, doc: Document, options?: UpdateOptions) {
    if (!this.#schema) {
      return;
    }
    const fns = this.#schema.getPreHookByMethod(MongoHookMethod.update);
    if (fns) {
      await Promise.all(fns.map(fn => fn(filter, doc, options)));
    }
  }

  private async afterUpdate(filter: Document, doc: Document, options?: UpdateOptions) {
    if (!this.#schema) {
      return;
    }
    const fns = this.#schema.getPostHookByMethod(MongoHookMethod.update);
    if (fns) {
      await Promise.all(fns.map(fn => fn(filter, doc, options)));
    }
  }

  async updateMany(filter: Document, doc: Document, options?: UpdateOptions) {
    if (filter._id && !(filter._id instanceof Bson.ObjectID)) {
      filter._id = new Bson.ObjectID(filter._id);
    }
    await this.preUpdate(filter, doc, options);
    const res = await update(this.#protocol, this.#dbName, this.name, filter, doc, {
      ...options,
      multi: options?.multi ?? true,
    });
    await this.afterUpdate(filter, doc, options);
    return res;
  }

  async deleteMany(filter: Document, options?: DeleteOptions): Promise<number> {
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
    return res.n;
  }

  delete = this.deleteMany;

  async deleteOne(filter: Document, options?: DeleteOptions) {
    return this.delete(filter, {...options, limit: 1});
  }

  async drop(options?: DropOptions): Promise<void> {
    const res = await this.#protocol.commandSingle(this.#dbName, {
      drop: this.name,
      ...options,
    });
  }

  async distinct(key: string, query?: Document, options?: DistinctOptions) {
    const {values} = await this.#protocol.commandSingle(this.#dbName, {
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
    return new ListIndexesCursor<{ v: number; key: Document; name: string; ns: string }>({
      protocol: this.#protocol,
      dbName: this.#dbName,
      collectionName: this.name,
    });
  }
}
