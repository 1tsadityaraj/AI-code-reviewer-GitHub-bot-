/**
 * Database utility helpers.
 * ⚠️ This file intentionally contains bugs for demo purposes.
 */

/**
 * Connects to the database and returns a client.
 */
async function connectDB() {
  // 🔴 SECURITY: Connection string with credentials in source code
  const connectionString =
    "mongodb://admin:p@ssw0rd123@prod-db.example.com:27017/myapp?authSource=admin";

  const client = require("mongodb").MongoClient;

  // 🟡 BUG: Missing `await` — connect is async
  const connection = client.connect(connectionString);

  console.log("Connected to database");
  return connection;
}

/**
 * Queries users with optional filters.
 */
async function queryUsers(db, filters = {}) {
  let query = {};

  // 🔴 SECURITY: SQL/NoSQL injection — directly interpolating user input into query
  if (filters.name) {
    query = { $where: `this.name === '${filters.name}'` };
  }

  // ⚡ PERFORMANCE: No limit — fetching ALL documents into memory
  const users = await db.collection("users").find(query).toArray();

  // ⚡ PERFORMANCE: O(n²) loop for deduplication instead of using a Set
  const uniqueEmails = [];
  for (let i = 0; i < users.length; i++) {
    let isDuplicate = false;
    for (let j = 0; j < uniqueEmails.length; j++) {
      if (uniqueEmails[j] === users[i].email) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      uniqueEmails.push(users[i].email);
    }
  }

  return { users, uniqueEmails };
}

/**
 * Bulk updates user records.
 */
async function bulkUpdateUsers(db, updates) {
  const results = [];

  // ⚡ PERFORMANCE: Sequential awaits in loop — should use bulkWrite
  for (const update of updates) {
    const result = await db
      .collection("users")
      .updateOne({ _id: update.id }, { $set: update.data });
    results.push(result);
  }

  return results;
}

module.exports = { connectDB, queryUsers, bulkUpdateUsers };
