// deno-lint-ignore-file no-explicit-any
// deno run -A --unstable tests/cases/20_schema.ts
import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "./../test.deps.ts";
import { Document, MongoHookMethod, UpdateOptions } from "../../src/types.ts";
import { closeConnection, getDB } from "../../src/utils/helper.ts";
import {
  getInstance,
  getMetadata,
  getModel,
  Prop,
  Schema,
} from "../../src/schema.ts";
import { dbUrl } from "../common.ts";

class User extends Schema {
  @Prop({
    required: true,
    index: true,
  })
  name!: string;

  @Prop({
    required: false,
  })
  age!: number;
}

const db = await getDB(dbUrl);

export default function schemaTests() {
  Deno.test({
    name: "schema instance test",
    fn() {
      const instance1 = getInstance(User);
      const instance2 = getInstance(User);
      assertEquals(instance1, instance2);
    },
  });

  Deno.test({
    name: "schema meta test",
    fn() {
      const shcemaMeta = Schema.getMeta();
      assertExists(shcemaMeta.createTime);
      assertExists(shcemaMeta.modifyTime);
    },
  });

  Deno.test({
    name: "User meta test",
    fn() {
      const userMeta = User.getMeta();
      assertEquals(userMeta.name, {
        required: true,
        index: true,
      });
      assertEquals(userMeta.age, {
        required: false,
      });
      assertExists(userMeta.createTime);
      assertExists(userMeta.modifyTime);
    },
  });

  Deno.test({
    name: "get User meta",
    fn() {
      const ageMeta = getMetadata(User, "age");
      assertEquals(ageMeta, {
        required: false,
      });

      const nameMeta = getMetadata(User, "name");
      assertEquals(nameMeta, {
        required: true,
        index: true,
      });
    },
  });

  Deno.test({
    name: "insert and find",
    async fn() {
      const model = await getModel<User>(
        db,
        User,
        "mongo_test_schema_users",
      );

      const id = await model.insertOne({
        "name": "zhangsan",
        "age": 18,
      });
      assertEquals(typeof id, "string");

      {
        const inserted = "MongoHookMethod.find";
        User.post(MongoHookMethod.findOne, function (doc) {
          assertNotEquals(doc, null, "hook findOne, doc must not be null");
          doc["inserted"] = inserted;
        });

        const doc: any = await model.findById(id);
        assertNotEquals(doc, null, "doc must not be null");
        assertEquals(doc["inserted"], inserted);
      }

      {
        const update = {
          $set: {
            "name": "bb",
            "age": 222,
            "sex": "man", // ex insert key
          },
        };
        const options = {
          new: true,
        };
        User.pre(
          MongoHookMethod.update,
          function (
            filter: Document,
            doc: Document,
            _options?: UpdateOptions,
          ) {
            assertExists(filter._id, "只测试findByIdAndUpdate，这时条件里肯定有_id");
            assertEquals(doc, update);
            assertEquals(_options!.new, true);
          },
        );

        User.post(MongoHookMethod.findOneAndUpdate, function (doc) {
          assertNotEquals(
            doc,
            null,
            "hook findOneAndUpdate, doc must not be null",
          );
          doc.addr = "haha";
        });

        const res: any = await model.findByIdAndUpdate(id, update, options);
        assertEquals(res.name, update.$set.name);
        assertEquals(res.age, update.$set.age);
        assertEquals(res.sex, undefined);
        assertEquals(
          res.addr,
          "haha",
          "hook findOneAndUpdate will inster name",
        );
      }

      {
        const id2 = await model.insertOne({
          "name": "lisi",
          "age": 3,
        });
        assertEquals(typeof id2, "string");

        const manyInserted = "MongoHookMethod.find";
        User.post(MongoHookMethod.findMany, function (docs) {
          assert(Array.isArray(docs));
          docs.forEach((item: any) => {
            item["inserted"] = manyInserted;
          });
        });

        const arr = await model.findMany({
          _id: {
            $in: [id, id2],
          },
        });
        arr.forEach((doc: any) => {
          assertEquals(doc._id, undefined);
          assert([id, id2].find((_id) => _id === doc.id));
          assertEquals(doc.inserted, manyInserted);
        });

        {
          const arr = await model.findMany({
            _id: {
              $in: [id, id2],
            },
          }, {
            remainOriginId: true,
          });
          arr.forEach((doc: any) => {
            assertExists(doc._id);
          });
        }

        {
          const arr = await model.findMany({
            _id: {
              $in: [id, id2],
            },
          }, {
            skip: 0, // 从0开始
            limit: 1,
            // sort: {
            //   age: 1,
            // },
          });

          assertEquals(arr.length, 1);
          assertEquals((arr[0] as any).id, id);
        }

        {
          const arr = await model.findMany({
            _id: {
              $in: [id, id2],
            },
          }, {
            sort: {
              age: 1,
            },
          });

          assertEquals(arr.length, 2);
          assertEquals((arr[0] as any).id, id2);
        }

        const deleteResult: any = await model.findByIdAndDelete(id2);
        assertEquals(deleteResult, 1);
      }

      // const deleteResult: any = await model.findByIdAndDelete(id);
      // assertEquals(deleteResult, 1);

      {
        await model.createIndexes({
          indexes: [{
            name: "_name2",
            key: { name: -1 },
          }],
        });
        let indexes = await model.listIndexes().toArray();
        assertEquals(
          indexes,
          [
            { v: 2, key: { _id: 1 }, name: "_id_" },
            { v: 2, key: { name: 1 }, name: "name_1" },
            { v: 2, key: { name: -1 }, name: "_name2" },
          ],
        );

        await model.syncIndexes();

        indexes = await model.listIndexes().toArray();
        assertEquals(
          indexes,
          [
            { v: 2, key: { _id: 1 }, name: "_id_" },
            { v: 2, key: { name: 1 }, name: "name_1" },
          ],
        );
      }

      {
        await model.deleteMany({});
        const nowArr = await model.find().toArray();
        assertEquals(nowArr.length, 0, "clear all");
        User.clearHooks();
      }
    },
  });

  Deno.test({
    name: "populate",
    async fn() {
      const userModel = await getModel<User>(
        db,
        User,
        "mongo_test_schema_users",
      );

      const user1 = {
        name: "zhangsan",
        age: 18,
      };
      const userId1 = await userModel.insertOne(user1);

      const user2 = {
        name: "lisi",
        age: 22,
      };
      const userId2 = await userModel.insertOne(user2);

      class Role extends Schema {
        @Prop()
        userId!: string;

        @Prop()
        name!: string;

        user?: User;
      }

      Role.virtual("user", {
        ref: User,
        localField: "userId",
        foreignField: "_id",
        justOne: true,
        isTransformLocalFieldToObjectID: true,
      });

      const roleModel = await getModel<Role>(
        db,
        Role,
        "mongo_test_schema_roles",
      );
      const role1 = {
        name: "admin",
        userId: userId1,
      };
      roleModel.insertOne(role1);

      const role2 = {
        name: "normal",
        userId: userId2,
      };
      roleModel.insertOne(role2);

      {
        const arr = await roleModel.findMany({}, {
          populates: {},
        });
        assertEquals(arr.length, 2);
        assertEquals(arr[0].user, undefined);
        assertEquals(arr[1].user, undefined);
      }
      {
        const arr = await roleModel.findMany({}, {
          populates: {
            user: {
              name: 1,
              age: 1,
            },
          },
        });
        assertEquals(arr.length, 2);
        assertEquals(Array.isArray(arr[0].user), false, "justOne work");
        assertEquals(arr[0].user!.name, user1.name);
        assertEquals(arr[0].user!.age, user1.age);
        assertEquals(arr[1].user!.name, user2.name);
        assertEquals(arr[1].user!.age, user2.age);
        const user = arr[0].user!;
        assertEquals(Object.keys(user).length, 2);
        assertEquals(Object.keys(user), ["name", "age"]);
        assertEquals(arr[0].user!._id, undefined);
        assertEquals(arr[1].user!._id, undefined);
      }

      {
        const arr = await roleModel.findMany({}, {
          populates: {
            user: {
              _id: 0,
              name: 0,
              // age: 1,
            },
            // user: "group",
            // user: "-_id -title",
          },
        });
        assertEquals(arr.length, 2);
        const user = arr[0].user!;
        assertEquals(user.name, undefined);
        assertEquals(user._id, undefined);
        assertExists(user.age);
      }

      {
        const arr = await roleModel.findMany({}, {
          populates: {
            user: "name age",
          },
        });
        assertEquals(arr.length, 2);
        const user = arr[0].user!;
        assertEquals(Object.keys(user).length, 2);
        assertEquals(Object.keys(user), ["name", "age"]);
        assertEquals(arr[0].user!._id, undefined);
        assertEquals(arr[1].user!._id, undefined);
      }

      {
        const arr = await roleModel.findMany({}, {
          populates: {
            user: "-_id -name",
          },
        });
        assertEquals(arr.length, 2);
        assertEquals(arr.length, 2);
        const user = arr[0].user!;
        assertEquals(user.name, undefined);
        assertEquals(user._id, undefined);
        assertExists(user.age);
      }

      // return closeConnection();
    },
  });
}
