// This file must be imported FIRST — before any service that reads process.env
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const result = dotenv.config({ path: join(__dirname, "../.env"), override: true });

if (result.error) {
  console.error("Failed to load .env:", result.error.message);
}
