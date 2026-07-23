import { getPendingUsers } from "./src/lib/admin";

async function run() {
  console.log("Fetching pending users...");
  const users = await getPendingUsers();
  console.log("Users:", users);
}

run();
