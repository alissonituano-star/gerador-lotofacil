import { spawn } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const hostArg = args.find((arg) => arg.startsWith("--host="));
const portArg = args.find((arg) => arg.startsWith("--port="));

function run(command, commandArgs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${commandArgs.join(" ")} saiu com codigo ${code}`));
    });
  });
}

const serveArgs = ["scripts/serve.mjs"];
if (hostArg) serveArgs.push(hostArg);
if (portArg) serveArgs.push(portArg);
await run("node", serveArgs);
