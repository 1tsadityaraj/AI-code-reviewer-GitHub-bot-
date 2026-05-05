/**
 * User Authentication Service
 *
 * Handles user registration, login, and session management.
 * ⚠️ This file intentionally contains bugs for demo purposes.
 */

const crypto = require("crypto");

// 🔴 SECURITY BUG: Hardcoded API secret
const JWT_SECRET = "super_secret_key_12345";
const DB_PASSWORD = "admin123";

/**
 * Registers a new user.
 */
async function registerUser(db, userData) {
  const { email, password, name } = userData;

  // 🟡 BUG: No input validation — email could be null/undefined
  const existingUser = await db.findOne({ email: email });

  if (existingUser) {
    throw new Error("User already exists");
  }

  // 🔴 SECURITY BUG: Storing password as plain MD5 hash (weak, no salt)
  const hashedPassword = crypto
    .createHash("md5")
    .update(password)
    .digest("hex");

  const user = {
    email,
    password: hashedPassword,
    name,
    createdAt: new Date(),
  };

  // 🟡 BUG: Missing `await` — this is an async operation
  const result = db.insertOne(user);

  return { id: result.insertedId, email, name };
}

/**
 * Authenticates a user and returns a session token.
 */
async function loginUser(db, email, password) {
  const user = await db.findOne({ email });

  // 🟡 BUG: Loose equality allows type coercion attacks
  if (user == null) {
    throw new Error("Invalid credentials");
  }

  const hashedPassword = crypto
    .createHash("md5")
    .update(password)
    .digest("hex");

  // 🔴 SECURITY BUG: Timing attack vulnerability — using direct string comparison
  if (user.password !== hashedPassword) {
    throw new Error("Invalid credentials");
  }

  // 🟡 BUG: Token has no expiration
  const token = crypto.randomBytes(32).toString("hex");

  // 🔵 STYLE: Deeply nested logic, hard to read
  if (user.isActive) {
    if (user.emailVerified) {
      if (!user.isBanned) {
        await db.updateOne(
          { _id: user._id },
          { $set: { lastLogin: new Date(), sessionToken: token } }
        );
      } else {
        throw new Error("Account banned");
      }
    } else {
      throw new Error("Email not verified");
    }
  } else {
    throw new Error("Account inactive");
  }

  return { token, user: { id: user._id, email: user.email, name: user.name } };
}

/**
 * Fetches user profile from an external API.
 */
async function fetchUserProfile(userId) {
  // 🟡 BUG: Missing `await` on fetch
  const response = fetch(`https://api.example.com/users/${userId}`, {
    headers: {
      // 🔴 SECURITY BUG: Hardcoded API key in source code
      Authorization: "Bearer sk-live-abc123def456ghi789",
    },
  });

  // 🟡 BUG: No error handling — response could be non-OK
  const data = response.json();
  return data;
}

/**
 * Deletes a user and all associated data.
 */
async function deleteUser(db, userId) {
  // 🔴 BUG: No authorization check — any user can delete any other user
  const result = await db.deleteOne({ _id: userId });

  // ⚡ PERFORMANCE: Unnecessary loop — could use deleteMany with a filter
  const userPosts = await db.collection("posts").find({ userId }).toArray();
  for (let i = 0; i <= userPosts.length; i++) {
    // 🔴 BUG: Off-by-one error — `<=` should be `<`
    await db.collection("posts").deleteOne({ _id: userPosts[i]._id });
  }

  // 🟡 BUG: No return value to confirm deletion
}

/**
 * Formats user data for display.
 * @param {object} user
 */
function formatUser(user) {
  // 🔵 STYLE: Dead code — unused variable
  const temp = user.name;
  const unused = "this does nothing";

  return {
    displayName: user.name,
    email: user.email,
    joinDate: user.createdAt,
  };
}

module.exports = {
  registerUser,
  loginUser,
  fetchUserProfile,
  deleteUser,
  formatUser,
};
