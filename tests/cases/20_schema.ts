// deno-lint-ignore-file no-explicit-any
// deno run -A --unstable tests/cases/20_schema.ts
import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "./../test.deps.ts";
import { Schema } from "../../src/schema.ts";
import { Document, MongoHookMethod, UpdateOptions } from "../../src/types.ts";
import {
  closeConnection,
  getDB,
  getMetadata,
  getModel,
  Prop,
} from "../../src/utils/helper.ts";

class User extends Schema {
  _id!: string;

  @Prop({
    required: true,
  })
  name!: string;

  @Prop({
    required: false,
  })
  age!: number;
}

export default function schemaTests() {
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
      });
    },
  });

  Deno.test({
    name: "insert and find",
    async fn() {
      const db = await getDB("mongodb://192.168.21.176:27018/test");
      const model = await getModel<User>(db, User, "mongo_test_schemas");

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

      closeConnection();
    },
  });
}
