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

Role.populate("user");

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
//   userId: "618f28832b0517228b47c8aa",
//   name: "normal",
// });

console.log(
  await roleModel.find({}, {
    skip: 1,
    limit: 1,
  }),
);
