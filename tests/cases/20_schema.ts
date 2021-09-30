// deno-lint-ignore-file no-explicit-any
// deno run -A --unstable tests/cases/20_schema.ts
import { Schema } from "../../src/schema.ts";
import { Document, MongoHookMethod, UpdateOptions } from "../../src/types.ts";
import {
  getDB,
  getMetadata,
  getModel,
  Prop,
} from "../../src/utils/helper.ts";

const db = await getDB("mongodb://192.168.21.176:27018/test");
// const db = await getDB("mongodb://localhost:27018/test");

class User extends Schema {
  _id!: string;

  @Prop({
    required: true,
  })
  name!: string;

  @Prop({
    required: true,
  })
  age!: number;
}

class Role extends Schema {
  _id!: string;

  @Prop({
    required: true,
  })
  role!: string;

  @Prop({
    required: true,
  })
  token!: string;
}

console.log(User.getMeta());
console.log(Role.getMeta());
console.log(Schema.getMeta());

console.log(getMetadata(User, "age"));

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
  console.log("----post--findOneAndUpdate--", doc);
  doc.name = "haha";
});

User.post(MongoHookMethod.findMany, function (docs) {
  console.log("----post--findMany--", docs);
  docs.forEach((item: any) => {
    item["inserted"] = "MongoHookMethod.find";
  });
});

User.post(MongoHookMethod.findOne, function (doc) {
  console.log("----post--findOne--", doc);
  if (!doc) {
    return;
  }
  doc["inserted"] = "MongoHookMethod.find";
});

const model = await getModel<User>(db, User);

// const res = await model.insertOne({
//   "name": 'aff',
//   "age": 18,
//   "enName": "few",
//   "email": "22",
//   "external": false,
//   "state": "active",
//   // "createTime": "2021-01-12T07:09:10.094Z",
//   // "modifyTime": "2021-01-12T07:37:45.527Z",
// });
// console.log(res.toString());

const res = await model.findByIdAndUpdate("613f1b073764056ec091fac2", {
  $set: {
    "groups": [
      "aaa",
      "bbb",
    ],
    "username": "式",
    "age": 222,
  },
}, {
  new: true,
});
console.log(res);

const doc = await model.findById("613f09dd6c2086525c6d6bba");
console.log(doc);

const arr = await model.findMany({
  // _id: {
  //   $in: ["60e6e614285ceda2e3c5c878", "60e6e6005fd742d2f03bda02"],
  // },
}, {
  remainOriginId: true,
  skip: 0, // 从0开始
  limit: 2,
  sort: {
    age: 1,
  },
});
console.log(arr);
