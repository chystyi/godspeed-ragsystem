// One-time setup after `npm install`: create .env from .env.example if it is missing.
import { copyFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  console.log(".env already exists, leaving it untouched");
} else {
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example. Fill in the keys before running `npm run dev`.");
}
