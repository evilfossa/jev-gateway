import type { Questions } from "@typesafe-ai/sdk";
import { truncate } from "./state.js";
import type { Json, JsonSchema, RouterTool } from "./types.js";

/** Choice label meaning "reply in text, call nothing". */
export const NO_TOOL = "no_tool_needed";
/** Choice label a shard uses to say "the right tool is not in this group". */
export const NONE_OF_THESE = "none_of_these";
/**
 * Most tools one tool question may offer. A Choice accepts 255 options, but state plus the longest
 * question must also fit Jev's 32k-token window, and below ~400 characters a description stops
 * telling similar tools apart — so big rosters (Claude Code sends ~280) are shortlisted first.
 */
export const MAX_TOOLS = 120;
export const SHORTLIST_PER_SHARD = 3;
/** Cap on speculative argument questions fanned out in the same Jev call. */
const MAX_ARG_QUESTIONS = 96;
const MAX_DESCRIPTION_CHARS = 1024;
/** Characters one tool question may spend on descriptions (~12k tokens). */
const QUESTION_CHAR_BUDGET = 48_000;

export const TOOL_KEY = "tool";
export const NEEDS_TOOL_KEY = "needs_tool";

/** A parameter whose value comes from a fixed set, so Jev can fill it. */
export type ClosedParam =
  | { name: string; required: boolean; kind: "const"; value: Json }
  | { name: string; required: boolean; kind: "boolean"; description?: string }
  | { name: string; required: boolean; kind: "enum"; description?: string; values: Map<string, Json> };

export interface ToolPlan {
  name: string;
  /** Present only when every parameter is closed-set: Jev can then produce the whole call. */
  closedParams?: ClosedParam[];
}

function closedParam(name: string, schema: JsonSchema, required: boolean): ClosedParam | undefined {
  if ("const" in schema) return { name, required, kind: "const", value: schema.const as Json };
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (schema.enum.length === 1) return { name, required, kind: "const", value: schema.enum[0]! };
    const values = new Map<string, Json>();
    for (const value of schema.enum) {
      if (value !== null && typeof value === "object") return undefined;
      values.set(String(value), value);
    }
    // Labels are what Jev sees; colliding labels ("1" vs 1) can't be mapped back.
    if (values.size !== schema.enum.length || values.size > 255) return undefined;
    return { name, required, kind: "enum", description: schema.description, values };
  }
  if (schema.type === "boolean") return { name, required, kind: "boolean", description: schema.description };
  return undefined;
}

export function planTool(tool: RouterTool): ToolPlan {
  const schema = tool.parameters;
  // Only function tools take JSON arguments, and without a recognizable object schema
  // there is nothing safe to infer about them.
  if (tool.kind !== "function") return { name: tool.name };
  if (schema && schema.type !== undefined && schema.type !== "object") return { name: tool.name };
  const required = new Set(schema?.required ?? []);
  const closedParams: ClosedParam[] = [];
  for (const [name, property] of Object.entries(schema?.properties ?? {})) {
    const param = closedParam(name, property, required.has(name));
    if (!param) return { name: tool.name };
    closedParams.push(param);
  }
  return { name: tool.name, closedParams };
}

export const argKey = (toolIndex: number, param: string) => `arg:${toolIndex}:${param}`;
export const statedKey = (toolIndex: number, param: string) => `stated:${toolIndex}:${param}`;

/** Closed arguments for one tool, keeping its index in the decision's roster. */
export function buildArgQuestions(plan: ToolPlan, toolIndex: number): Questions | undefined {
  if (!plan.closedParams) return undefined;
  const asked = plan.closedParams.filter((param) => param.kind !== "const");
  const cost = asked.reduce((sum, param) => sum + (param.required ? 1 : 2), 0);
  if (cost > MAX_ARG_QUESTIONS) return undefined;
  const questions: Questions = {};
  for (const param of asked) {
    const about = `the "${param.name}" argument of the tool "${plan.name}"${
      param.description ? ` (${truncate(param.description, MAX_DESCRIPTION_CHARS)})` : ""
    }`;
    questions[argKey(toolIndex, param.name)] =
      param.kind === "boolean"
        ? { type: "noul", instructions: `If the assistant calls "${plan.name}" now, should ${about} be true?` }
        : {
            type: "choice",
            instructions: `If the assistant calls "${plan.name}" now, what value should ${about} have?`,
            criteria: Object.fromEntries([...param.values.keys()].map((label) => [label, null])),
          };
    if (!param.required) {
      questions[statedKey(toolIndex, param.name)] = {
        type: "noul",
        instructions: `Does the conversation state or clearly imply a value for ${about}?`,
      };
    }
  }
  return questions;
}

function toolCriteria(tools: RouterTool[], descriptionBudget = QUESTION_CHAR_BUDGET): Record<string, string | null> {
  const limit = Math.min(MAX_DESCRIPTION_CHARS, Math.floor(descriptionBudget / tools.length));
  const criteria: Record<string, string | null> = {};
  for (const tool of tools) {
    const params = Object.keys(tool.parameters?.properties ?? {});
    // Descriptions lead with what the tool is for; the tail is usage detail Jev doesn't need.
    const description = tool.description?.trim().slice(0, limit);
    criteria[tool.name] = description || (params.length ? `Parameters: ${params.join(", ")}` : null);
  }
  return criteria;
}

export const shardKey = (index: number) => `shard:${index}`;

/**
 * First pass over a roster too big for one question: every shard is ranked in the same Jev call,
 * and the best few of each go on to the real decision — ranking wide, then judging a shortlist.
 */
export function buildShortlistQuestions(
  tools: RouterTool[],
  options: { maxTools?: number; descriptionBudget?: number } = {},
): { questions: Questions; shards: RouterTool[][] } {
  const shardCount = Math.ceil(tools.length / (options.maxTools ?? MAX_TOOLS));
  const size = Math.ceil(tools.length / shardCount);
  const shards = Array.from({ length: shardCount }, (_, index) => tools.slice(index * size, (index + 1) * size));
  const questions: Questions = {};
  shards.forEach((shard, index) => {
    questions[shardKey(index)] = {
      type: "choice",
      instructions:
        "Given the conversation, which of these tools would best advance the user's latest request " +
        "if the assistant called it next?",
      criteria: { ...toolCriteria(shard, options.descriptionBudget), [NONE_OF_THESE]: "None of the tools in this list fits the next step." },
    };
  });
  return { questions, shards };
}

/**
 * Hosted Jev batches selection and speculative arguments. Local Nimble asks selection first,
 * then uses buildArgQuestions for the chosen tool, since every question is a separate inference.
 */
export function buildQuestions(
  tools: RouterTool[],
  options: { allowNone: boolean; withArgs: boolean; descriptionBudget?: number },
): { questions: Questions; plans: ToolPlan[] } {
  const plans = tools.map(planTool);
  const criteria = toolCriteria(tools, options.descriptionBudget);
  if (options.allowNone) {
    criteria[NO_TOOL] =
      "No tool call is needed right now: the assistant should reply to the user in plain text " +
      "(answer directly, ask a clarifying question, or report results that tools already returned).";
  }

  const questions: Questions = {
    [TOOL_KEY]: {
      type: "choice",
      instructions:
        "Given the conversation, what should the assistant do next? " +
        "Pick the single tool whose call best advances the user's latest request.",
      criteria,
    },
    [NEEDS_TOOL_KEY]: {
      type: "noul",
      instructions:
        "Does the assistant need to call one of its tools now, rather than reply to the user in plain text?",
    },
  };
  if (!options.withArgs) return { questions, plans };

  let argQuestions = 0;
  plans.forEach((plan, toolIndex) => {
    const argumentsForTool = buildArgQuestions(plan, toolIndex);
    const cost = Object.keys(argumentsForTool ?? {}).length;
    if (!argumentsForTool || argQuestions + cost > MAX_ARG_QUESTIONS) {
      delete plan.closedParams;
      return;
    }
    argQuestions += cost;
    Object.assign(questions, argumentsForTool);
  });
  return { questions, plans };
}
