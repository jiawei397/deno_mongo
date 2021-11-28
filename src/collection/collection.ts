// deno-lint-ignore-file no-explicit-any
import { blue, Bson, yellow } from "../../deps.ts";
import { MongoDriverError } from "../error.ts";
import { WireProtocol } from "../protocol/mod.ts";
import {
  getModelByName,
  initModel,
  SchemaCls,
  transferPopulateSelect,
} from "../schema.ts";
import {
  AggregateOptions,
  AggregatePipeline,
  CountOptions,
  CreateIndexOptions,
  DeleteOptions,
  DistinctOptions,
  Document,
  DropIndexOptions,
  DropOptions,
  Filter,
  FindAndModifyOptions,
  FindOptions,
  FindOriginOptions,
  InsertDocument,
  InsertOptions,
  MongoHookMethod,
  PopulateSelect,
  SchemaType,
  UpdateFilter,
  UpdateOptions,
  VirtualTypeOptions,
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

  getPopulateMap(populates?: Record<string, PopulateSelect>) {
    let populateMap: Map<string, PopulateSelect> | undefined;
    if (populates) {
      populateMap = new Map();
      for (const key in populates) {
        populateMap.set(key, transferPopulateSelect(populates[key]));
      }
    } else {
      populateMap = this.#schema?.getPopulateMap();
    }
    return populateMap;
  }

  getPopulateParams() {
    return this.#schema?.getPopulateParams();
  }

  private _find(
    filter?: Document,
    options?: FindOptions,
  ) {
    const {
      remainOriginId: _,
      populates,
      ...others
    } = options || {}; // must drop it otherwise will call error
    const populateParams = this.getPopulateParams();
    const populateMap = this.getPopulateMap(populates);
    if (populateParams && populateMap) {
      return this.findWithVirtual({
        populateMap,
        populateParams,
        filter,
        options,
      });
    } else {
      return this.findWithOrigin(
        filter,
        others,
      );
    }
  }

  private findWithOrigin(
    filter?: Document,
    options?: FindOriginOptions,
  ) {
    const res = new FindCursor<T>({
      filter,
      protocol: this.#protocol,
      collectionName: this.name,
      dbName: this.#dbName,
      options: options || {},
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

  private findWithVirtual(virturalOptions: {
    populateMap: Map<string, PopulateSelect>;
    populateParams: Map<string, VirtualTypeOptions>;
    filter?: Document;
    options?: FindOptions;
  }) {
    const { populateMap, populateParams, filter, options } = virturalOptions;
    const paramsArray = [];
    if (filter) {
      paramsArray.push({
        $match: filter,
      });
    }
    if (options?.sort) {
      paramsArray.push({
        $sort: options.sort,
      });
    }
    if (options?.skip !== undefined) {
      paramsArray.push({
        $skip: options.skip,
      });
    }
    if (options?.limit) {
      paramsArray.push({
        $limit: options.limit,
      });
    }
    const addFields: any = {};
    for (const [key, value] of populateParams) {
      if (!populateMap.has(key)) {
        continue;
      }
      let from = value.ref;
      if (typeof from === "function") {
        from = getModelByName(from);
      }
      if (
        value.isTransformLocalFieldToObjectID ||
        value.isTransformObjectIDToLocalField
      ) {
        if (value.isTransformLocalFieldToObjectID) {
          addFields[value.localField] = {
            $toObjectId: "$" + value.localField,
          };
        } else if (value.isTransformLocalFieldToString) {
          addFields[value.localField] = {
            $toString: "$" + value.localField,
          };
        }
        paramsArray.push({
          $addFields: addFields,
        });
      }
      paramsArray.push({
        $lookup: {
          from,
          localField: value.localField,
          foreignField: value.foreignField,
          as: key,
        },
      });
    }

    return this.aggregate(paramsArray);
  }

  private async preFind(
    hookType: MongoHookMethod,
    filter?: Document,
    options?: FindOptions,
  ) {
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
      docs.forEach((doc) => this.formatFindDoc(doc, options));
    } else {
      await this.postHooks(MongoHookMethod.findOne, docs, filter, options);
      this.formatFindDoc(docs, options);
    }
  }

  async findOne<U = T>(
    filter?: Filter<T>,
    options?: FindOptions,
  ) {
    await this.preFind(MongoHookMethod.findOne, filter, options);
    const doc = await this._find(filter, options).next();
    await this.afterFind(doc, filter, options);
    return doc as unknown as U;
  }

  async findMany<U = T>(
    filter?: Document,
    options?: FindOptions,
  ) {
    await this.preFind(MongoHookMethod.findMany, filter, options);
    const docs = await this._find(filter, options).toArray();
    await this.afterFind(docs, filter, options);
    return docs as unknown as U[];
  }

  find = this.findWithOrigin;

  private formatFindDoc(doc: any, options?: FindOptions) {
    if (!doc) {
      return;
    }
    const { remainOriginId, populates } = options || {};
    if (!doc.id) {
      doc.id = doc._id.toString();
      if (!remainOriginId) {
        delete doc._id;
      }
    }
    const params = this.getPopulateParams();
    if (!params) {
      return;
    }
    const map = this.getPopulateMap(populates);
    if (!map) {
      return;
    }
    for (const [key, value] of params) {
      if (!map.has(key) || !doc[key]) {
        continue;
      }
      const arr = doc[key] as any[];
      const pickMap = map.get(key);
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (value.justOne) {
          doc[key] = this.pickVirtual(item, pickMap);
          break;
        } else {
          arr[i] = this.pickVirtual(item, pickMap);
        }
      }
    }
  }

  private pickVirtual(virtualDoc: any, pickMap: any) {
    let needKeep = false; // if specified some key, then will pick this keys
    for (const k in pickMap) {
      if (pickMap[k]) {
        needKeep = true;
        break;
      }
    }
    if (needKeep) {
      const newObj: any = {};
      for (const k in pickMap) {
        if (pickMap[k]) {
          newObj[k] = virtualDoc[k];
        }
      }
      return newObj;
    } else {
      for (const k in pickMap) {
        if (!pickMap[k]) {
          delete virtualDoc[k];
        }
      }
      return virtualDoc;
    }
  }

  private formatBsonId(filter?: Document) {
    if (filter) {
      if (filter?._id) {
        const id = filter._id;
        if (typeof id === "string") {
          filter._id = new Bson.ObjectId(id);
        } else if (Array.isArray(id.$in)) {
          id.$in = id.$in.map((_id: any) => {
            if (typeof _id === "string") {
              return new Bson.ObjectId(_id);
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

  /**
   * Find and modify a document in one, returning the matching document.
   *
   * @param query The query used to match documents
   * @param options Additional options for the operation (e.g. containing update
   * or remove parameters)
   * @returns The document matched and modified
   */
  async findAndModify(
    filter?: Filter<T>,
    options?: FindAndModifyOptions<T>,
  ): Promise<T | undefined> {
    const result = await this.#protocol.commandSingle<{
      value: T;
      ok: number;
      lastErrorObject: any;
    }>(this.#dbName, {
      findAndModify: this.name,
      query: filter,
      ...options,
    });
    if (result.ok === 0) {
      throw new MongoDriverError("Could not execute findAndModify operation");
    }
    return result.value;
  }

  async countDocuments(
    filter?: Filter<T>,
    options?: CountOptions,
  ): Promise<number> {
    const pipeline: AggregatePipeline<T>[] = [];
    if (filter) {
      pipeline.push({ $match: filter });
    }

    if (typeof options?.skip === "number") {
      pipeline.push({ $skip: options.limit });
      delete options.skip;
    }

    if (typeof options?.limit === "number") {
      pipeline.push({ $limit: options.limit });
      delete options.limit;
    }

    pipeline.push({ $group: { _id: 1, n: { $sum: 1 } } });

    const result = await this.aggregate<{ n: number }>(
      pipeline,
      options as AggregateOptions,
    ).next();
    if (result) return result.n;
    return 0;
  }

  async estimatedDocumentCount(): Promise<number> {
    const pipeline = [
      { $collStats: { count: {} } },
      { $group: { _id: 1, n: { $sum: "$count" } } },
    ];

    const result = await this.aggregate<{ n: number }>(pipeline).next();
    if (result) return result.n;
    return 0;
  }

  async insertOne(doc: InsertDocument<T>, options?: InsertOptions) {
    const { insertedIds } = await this.insertMany([doc], options);
    return insertedIds[0];
  }

  /**
   * @deprecated Use `insertOne, insertMany` or `bulkWrite` instead.
   */
  insert(
    docs: InsertDocument<T> | InsertDocument<T>[],
    options?: InsertOptions,
  ) {
    docs = Array.isArray(docs) ? docs : [docs];
    return this.insertMany(docs, options);
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
          if (!data.hasOwnProperty(dk) && dk !== "_id") {
            console.warn(
              yellow(`remove undefined key [${blue(dk)}] in Schema`),
            );
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
    docs: InsertDocument<T>[],
    options?: InsertOptions,
  ): Promise<
    {
      insertedIds: string[];
      insertedCount: number;
    }
  > {
    const insertedIds = docs.map((doc) => {
      if (!doc._id) {
        doc._id = new Bson.ObjectId();
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
      insertedIds: insertedIds.map((id) => (id as Bson.ObjectId).toHexString()),
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
    update: UpdateFilter<T>,
    options?: UpdateOptions,
  ) {
    const filter = {
      _id: new Bson.ObjectId(id),
    };
    return this.findOneAndUpdate(filter, update, options);
  }

  findById(
    id: string,
    options?: FindOptions,
  ) {
    const filter = {
      _id: new Bson.ObjectId(id),
    };
    return this.findOne(filter, options);
  }

  async findOneAndUpdate(
    filter: Filter<T>,
    update: UpdateFilter<T>,
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

  async updateOne(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options?: UpdateOptions,
  ) {
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
          if (!Object.prototype.hasOwnProperty.call(doc, dk)) {
            continue;
          }
          if (dk.startsWith("$")) { // mean is mongo query
            removeKey(doc[dk]);
          } else {
            if (!Object.prototype.hasOwnProperty.call(data, dk)) {
              console.warn(
                yellow(`remove undefined key [${blue(dk)}] in Schema`),
              );
              delete doc[dk];
            }
          }
        }
      };
      removeKey(doc);
    }

    // add modifyTime
    if (doc["$set"]) {
      doc["$set"]["modifyTime"] = new Date();
    } else {
      doc["$set"] = {
        modifyTime: new Date(),
      };
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

  async updateMany(
    filter: Filter<T>,
    doc: UpdateFilter<T>,
    options?: UpdateOptions,
  ) {
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

  async deleteMany(
    filter: Filter<T>,
    options?: DeleteOptions,
  ): Promise<number> {
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

  deleteOne(
    filter: Filter<T>,
    options?: DeleteOptions,
  ) {
    return this.delete(filter, { ...options, limit: 1 });
  }

  findOneAndDelete = this.deleteOne;

  deleteById(id: string) {
    const filter = {
      _id: new Bson.ObjectId(id),
    };
    return this.deleteOne(filter);
  }

  findByIdAndDelete = this.deleteById;

  async drop(options?: DropOptions): Promise<void> {
    await this.#protocol.commandSingle(this.#dbName, {
      drop: this.name,
      ...options,
    });
  }

  async distinct(key: string, query?: Filter<T>, options?: DistinctOptions) {
    const { values } = await this.#protocol.commandSingle(this.#dbName, {
      distinct: this.name,
      key,
      query,
      ...options,
    });
    return values;
  }

  aggregate<U = T>(
    pipeline: AggregatePipeline<U>[],
    options?: AggregateOptions,
  ): AggregateCursor<U> {
    return new AggregateCursor<U>({
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

  async dropIndexes(options: DropIndexOptions) {
    const res = await this.#protocol.commandSingle<{
      ok: number;
      nIndexesWas: number;
    }>(
      this.#dbName,
      {
        dropIndexes: this.name,
        ...options,
      },
    );

    return res;
  }

  async syncIndexes() {
    if (!this.#schema) {
      return false;
    }
    await this.dropIndexes({
      index: "*",
    });
    await initModel(this, this.#schema);
    return true;
  }

  listIndexes() {
    return new ListIndexesCursor<
      { v: number; key: Document; name: string; ns?: string }
    >({
      protocol: this.#protocol,
      dbName: this.#dbName,
      collectionName: this.name,
    });
  }
}
