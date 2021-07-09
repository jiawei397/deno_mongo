// deno run -A --unstable tests/cases/20_schema.ts
import { Schema } from "../../src/schema.ts";
import { Document, MongoHookMethod, UpdateOptions } from "../../src/types.ts";
import { getDB, getModel, Prop } from "../../src/utils/helper.ts";

const db = await getDB("mongodb://192.168.21.176:27018/auth-test");

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
    // expires: 60, // seconds
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

// await model.insertOne({
//   "groups": [
//     "aaa",
//   ],
//   "id": 5,
//   "username": 'aff',
//   "enName": "few",
//   "email": "22",
//   "external": false,
//   "state": "active",
//   "createTime": "2021-01-12T07:09:10.094Z",
//   "modifyTime": "2021-01-12T07:37:45.527Z",
// });

const res = await model.findByIdAndUpdate("60e6e6005fd742d2f03bda02", {
  $set: {
    // "groups": [
    //   "aaa",
    //   "bbb",
    // ],
    "username": "jw2",
  },
}, {
  new: true,
});
console.log(res);

// const arr = await model.findMany({});
// console.log(arr);
