import { getDB, getModel, Prop, Schema } from "../mod.ts";

const db = await getDB("mongodb://localhost:27018/test");

class User extends Schema {
  @Prop()
  group!: string;

  @Prop()
  title!: string;
}

class Role extends Schema {
  @Prop()
  userId!: string;

  @Prop()
  name!: string;
}

Role.virtual("user", {
  ref: User,
  localField: "userId",
  foreignField: "_id",
  justOne: true,
  isTransformLocalFieldToObjectID: true,
});

// Role.populate("user", {
//   // _id: 0,
//   group: 1,
//   // title: 1,
// });
// Role.populate("user", "group");
// Role.populate("user", "-group -createTime");
// Role.populate("user", "title group");

const userModel = await getModel<User>(db, User);

// const id = await userModel.insertOne({
//   group: "spacex",
//   title: "zn",
// });
// console.log(id);

// const arr = await userModel.find().toArray();
// console.log(arr);

const roleModel = await getModel<Role>(db, Role);

// roleModel.insertOne({
//   userId: id,
//   name: "normal",
// });

console.log(
  await roleModel.findMany({}, {
    // skip: 1,
    // limit: 1,
    // remainOriginId: true,
    populates: {
      // user: {
      //   // _id: 1,
      //   id: 1,
      //   group: 1,
      //   title: 1,
      // },
      // user: "group",
      user: true,
      // user: "-_id -title",
    },
  }),
);
