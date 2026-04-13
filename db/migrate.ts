import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "fs";

const DB_PATH = "./data/crm.db";
const dir = "data";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite);

console.log("Running migrations...");
migrate(db, { migrationsFolder: "./db/migrations" });
console.log("Migrations complete.");

sqlite.close();
