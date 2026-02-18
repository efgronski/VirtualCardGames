import Database from 'better-sqlite3';

const dbFile = process.env.DB_FILE || './data.sqlite';
const db = new Database(dbFile);

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const createUserStmt = db.prepare(
  'INSERT INTO users (username, password_hash) VALUES (?, ?)'
);
const findUserByUsernameStmt = db.prepare(
  'SELECT id, username, password_hash FROM users WHERE username = ?'
);
const findUserByIdStmt = db.prepare(
  'SELECT id, username FROM users WHERE id = ?'
);

export function createUser(username, passwordHash) {
  return createUserStmt.run(username, passwordHash);
}

export function findUserByUsername(username) {
  return findUserByUsernameStmt.get(username);
}

export function findUserById(id) {
  return findUserByIdStmt.get(id);
}
