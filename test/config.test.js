// Validates the Claude Code configuration shipped in the repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(path.join(root, p), "utf8"));

test(".mcp.json registers the duplo-train stdio server", () => {
  const cfg = readJson(".mcp.json");
  const s = cfg.mcpServers["duplo-train"];
  assert.ok(s, "duplo-train server missing");
  assert.equal(s.command, "node");
  assert.deepEqual(s.args, ["src/server.js"]);
});

test(".claude/settings.json approves the server, allows its tools and wires horn hooks", () => {
  const s = readJson(".claude/settings.json");
  assert.ok(s.enabledMcpjsonServers.includes("duplo-train"));
  assert.ok(s.permissions.allow.includes("mcp__duplo-train"));
  for (const event of ["Stop", "Notification"]) {
    const hook = s.hooks[event][0].hooks[0];
    assert.equal(hook.type, "mcp_tool");
    assert.equal(hook.server, "duplo-train");
    assert.equal(hook.tool, "horn");
    assert.equal(hook.input.onlyIfConnected, true);
  }
});

test("slash commands have frontmatter and only reference duplo-train tools", () => {
  const dir = path.join(root, ".claude", "commands");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  for (const expected of ["horn.md", "train-connect.md", "train-start.md", "train-stop.md"]) {
    assert.ok(files.includes(expected), `${expected} missing`);
  }
  for (const f of files) {
    const text = readFileSync(path.join(dir, f), "utf8");
    assert.match(text, /^---\r?\n[\s\S]*?description:/, `${f}: missing description frontmatter`);
    const tools = text.match(/^allowed-tools:(.*)$/m)?.[1] ?? "";
    for (const t of tools.split(",").map((x) => x.trim()).filter(Boolean)) {
      assert.match(t, /^mcp__duplo-train__\w+$/, `${f}: unexpected tool ${t}`);
    }
  }
});
