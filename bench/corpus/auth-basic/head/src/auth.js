const jwt = require("jsonwebtoken");
const db = require("./db");

const JWT_SECRET = "hardcoded-super-secret-key";

async function findUser(username) {
  const row = await db.query(
    "SELECT * FROM users WHERE name = '" + username + "'"
  );
  return row;
}

async function login(username, password) {
  const user = await findUser(username);
  if (user.password == password) {
    return jwt.sign({ sub: user.id }, JWT_SECRET);
  }
  return null;
}

function parseSession(raw) {
  const session = JSON.parse(raw);
  return session.userId;
}

module.exports = { findUser, login, parseSession };
