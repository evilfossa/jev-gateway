import { describe, expect, it } from "vitest";
// @ts-ignore: development scripts are plain ESM.
import { recordClientEvent, requestFacts } from "../scripts/verify-nimble-sessions.mjs";

const SECRET = "private conversation and credentials";
const facts = () => ({ toolCalls: 0, toolResults: 0, read: false, edit: false, check: false, final: false, completed: false, thinking: false });

describe("live session metadata", () => {
  it("records protocol features without retaining content or arguments", () => {
    const result = requestFacts({ model: "test", thinking: { type: "adaptive" },
      system: [{ type: "text", text: SECRET, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "tool_result", content: SECRET, tool_use_id: SECRET }] }],
      headers: { authorization: SECRET }, tools: [{ name: "read", input_schema: { secret: SECRET } }],
    });
    expect(result).toEqual({ model: "test", thinking: true, promptCache: true, toolResult: true });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(requestFacts({ input: [{ type: "function_call_output", output: SECRET }] }).toolResult).toBe(true);
    expect(requestFacts({ input: [{ type: "custom_tool_call_output", output: SECRET }] }).toolResult).toBe(true);
  });

  it("requires completed Codex actions and a final turn", () => {
    const result = facts();
    recordClientEvent(result, "codex", { type: "item.completed", item: { type: "command_execution", command: "cat math.mjs verify.mjs", aggregated_output: SECRET } });
    recordClientEvent(result, "codex", { type: "item.completed", item: { type: "file_change", changes: [{ path: SECRET }] } });
    recordClientEvent(result, "codex", { type: "item.completed", item: { type: "command_execution", command: "node verify.mjs", aggregated_output: SECRET } });
    recordClientEvent(result, "codex", { type: "item.completed", item: { type: "agent_message", text: SECRET } });
    recordClientEvent(result, "codex", { type: "turn.completed" });
    expect(result).toMatchObject({ toolCalls: 3, toolResults: 3, read: true, edit: true, check: true, final: true, completed: true });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("records Claude tool results and thinking without storing their text", () => {
    const result = facts();
    recordClientEvent(result, "claude", { type: "assistant", message: { content: [
      { type: "thinking", thinking: SECRET }, { type: "tool_use", name: "Read", input: { file_path: SECRET } },
      { type: "tool_use", name: "Edit", input: { new_string: SECRET } }, { type: "tool_use", name: "Bash", input: { command: "node verify.mjs" } },
    ] } });
    recordClientEvent(result, "claude", { type: "user", message: { content: [{ type: "tool_result", content: SECRET }] } });
    recordClientEvent(result, "claude", { type: "result", is_error: false, result: SECRET });
    expect(result).toMatchObject({ toolCalls: 3, toolResults: 1, read: true, edit: true, check: true, thinking: true, final: true, completed: true });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
