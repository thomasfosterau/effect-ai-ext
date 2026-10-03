// Fixture for tests/cli/loader.test.ts: an extensionless file import and a
// directory import, neither of which Node's default ESM resolver accepts.
import { dep } from "./dep";
import { sub } from "./sub";

console.log(`${dep}+${sub}`);
