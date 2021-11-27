# deno_mongo_schema

forked from **[deno_mongo](https://deno.land/x/mongo)**, support shema and
extend some API.

> **deno_mongo** is a **MongoDB** database driver developed for deno

[![tag](https://img.shields.io/github/tag/manyuanrong/deno_mongo.svg)](https://github.com/manyuanrong/deno_mongo/releases)
[![Build Status](https://github.com/manyuanrong/deno_mongo/workflows/ci/badge.svg?branch=main)](https://github.com/manyuanrong/deno_mongo/actions)
[![license](https://img.shields.io/github/license/manyuanrong/deno_mongo.svg)](https://github.com/manyuanrong/deno_mongo)
[![tag](https://img.shields.io/badge/deno-v1.8.1-green.svg)](https://github.com/denoland/deno)

## Links

- [Docs](https://doc.deno.land/https/deno.land/x/mongo/mod.ts)
- [Guides]() TODO
- [Examples]() TODO
- [Benchmarks]() TODO

## Examples

```ts
import {
  getDB,
  getModel,
  Prop,
  Schema,
} from "https://deno.land/x/jw_mongo@v0.24.20/mod.ts";
import type {
  Document,
  MongoHookMethod,
} from "https://deno.land/x/jw_mongo@v0.24.20/mod.ts";

const db = await getDB("mongodb://localhost:27017/test");

class User extends Schema {
  @Prop()
  external!: boolean;

  @Prop()
  modifyTime!: Date;

  @Prop()
  createTime!: Date;

  @Prop()
  enName!: string;

  @Prop()
  groups!: string[];

  _id!: string;

  @Prop({
    unique: true,
  })
  id!: string;

  @Prop()
  avatar!: string;

  @Prop()
  state!: string;

  @Prop({
    required: true,
  })
  email!: string;

  @Prop({
    required: true,
  })
  username!: string;

  @Prop({
    default: Date.now,
    expires: 60, // seconds
  })
  expires?: Date;
}

User.pre(
  MongoHookMethod.update,
  function (filter: Document, doc: Document, options?: UpdateOptions) {
    console.log("----pre----", filter, doc, options);
    if (!doc.$set) {
      doc.$set = {};
    }
    doc.$set.modifyTime = new Date();
  },
);

User.post(MongoHookMethod.findOneAndUpdate, function (doc) {
  console.log("----post----", doc);
  doc.name = "haha";
});

const model = await getModel<User>(db, User);

await model.insertOne({
  "groups": [
    "aaa",
  ],
  "id": 3,
  "username": 464,
  "enName": "aa",
  "email": "aaw",
  "external": false,
  "state": "active",
  "createTime": "2021-01-12T07:09:10.094Z",
  "modifyTime": "2021-01-12T07:37:45.527Z",
});
```

Below is origin example:

```ts
import {
  Bson,
  MongoClient,
} from "https://deno.land/x/jw_mongo@v0.24.20/mod.ts";

const client = new MongoClient();

//Connecting to a Local Database
await client.connect("mongodb://localhost:27017");

//Connecting to a Mongo Atlas Database
await client.connect({
  db: "<db_name>",
  tls: true,
  servers: [
    {
      host: "<db_cluster_url>",
      port: 27017,
    },
  ],
  credential: {
    username: "<username>",
    password: "<password>",
    db: "<db_name>",
    mechanism: "SCRAM-SHA-1",
  },
});

//Or
await client.connect(
  "mongodb+srv://<username>:<password>@<db_cluster_url>/<db_name>?authMechanism=SCRAM-SHA-1",
);

// Defining schema interface
interface UserSchema {
  _id: { $oid: string };
  username: string;
  password: string;
}

const db = client.database("test");
const users = db.collection<UserSchema>("users");

// insert
const insertId = await users.insertOne({
  username: "user1",
  password: "pass1",
});

// insertMany
const insertIds = await users.insertMany([
  {
    username: "user1",
    password: "pass1",
  },
  {
    username: "user2",
    password: "pass2",
  },
]);

// findOne
const user1 = await users.findOne({ _id: insertId });

// find
const all_users = await users.find({ username: { $ne: null } }).toArray();

// find by ObjectId
const user1_id = await users.findOne({
  _id: new Bson.ObjectId("SOME OBJECTID STRING"),
});

// count
const count = await users.count({ username: { $ne: null } });

// aggregation
const docs = await users.aggregate([
  { $match: { username: "many" } },
  { $group: { _id: "$username", total: { $sum: 1 } } },
]);

// updateOne
const { matchedCount, modifiedCount, upsertedId } = await users.updateOne(
  { username: { $ne: null } },
  { $set: { username: "USERNAME" } },
);

// updateMany
const { matchedCount, modifiedCount, upsertedId } = await users.updateMany(
  { username: { $ne: null } },
  { $set: { username: "USERNAME" } },
);

// deleteOne
const deleteCount = await users.deleteOne({ _id: insertId });

// deleteMany
const deleteCount2 = await users.deleteMany({ username: "test" });

// Skip
const skipTwo = await users.find({}, {
  skip: 0,
});

// Limit
const featuredUser = await users.find({}, {
  limit: 5,
});

// Sort
const featuredUser = await users.find({}, {
  sort: {
    age: -1,
  },
});

// or use skip limit and sort
const featuredUser = await users.find({}, {
  skip: 0,
  limit: 5,
  sort: {
    age: -1,
  },
});

// GridFS Upload
const bucket = new GridFSBucket(db);
const upstream = bucket.openUploadStream("test.txt");

const writer = upstream.getWriter();
writer.write(fileContents);

await writer.close();

//GridFS Download
const file = await new Response(bucket.openDownloadStream(id)).text();
```

## Contributing

### Command to be implemented

https://docs.mongodb.com/manual/reference/command/

### API style refer to

http://mongodb.github.io/node-mongodb-native/3.6/api/
