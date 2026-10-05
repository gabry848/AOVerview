import { databasePath } from "./config.js";
import { migrateDatabase } from "./database.js";

migrateDatabase(databasePath);
console.log("AOVerview database ready.");
