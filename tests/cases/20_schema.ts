// deno run -A --unstable tests/cases/20_schema.ts 
import { Schema } from "../../src/shema.ts";
import { Document, MongoHookMethod } from "../../src/types.ts";
import { getDB, Prop, getModel } from "../../src/utils/helper.ts";

const db = await getDB("mongodb://localhost:27018/auth");


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

  @Prop()
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

}

User.pre(MongoHookMethod.create, function (docs: Document[]) {
  console.log('----pre----');
})

User.pre(MongoHookMethod.create, function (docs: Document[]) {
  console.log('----pre2----');
})

const model = await getModel(db, User);

await model.insertOne({
  "groups": [
    "aaa",
  ],
  "id": "2",
  "username": "aa",
  "enName": "aa",
  "external": false,
  "state": "active",
  "createTime": "2021-01-12T07:09:10.094Z",
  "modifyTime": "2021-01-12T07:37:45.527Z",
});
