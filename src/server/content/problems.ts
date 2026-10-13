import type { z } from "zod";
import fa from "@/i18n/fa.json";
import { t, type MessageKey, type MessageVars } from "@/i18n";

/**
 * Why a record was rejected or flagged (PRD §13.3). Problems are stored in the batch report as keys
 * and values, and turned into words only when shown: plain Persian with Persian field names for the
 * admin, and the same sentence with the JSON field path for the chatbot's fix prompt.
 */
export type ProblemKey = keyof typeof fa.content.problems;
export type Problem = { key: ProblemKey; vars?: Record<string, string | number> };

export const problem = (key: ProblemKey, vars?: Problem["vars"]): Problem => ({ key, vars });

type FieldKey = keyof typeof fa.content.fields;

const questionPath = /(?:^|\.)question_sets\.(reading|listening)\.(A|B)(?:\[(\d+)\])?(?:\.(.+))?$/;
const turnPath = /(?:^|\.)turns\[(\d+)\](?:\.(.+))?$/;

/**
 * "tokens[3].surface" -> "surface": the admin sees the field's Persian name. A text's question and a
 * dialogue's turn also say which one it is.
 */
function fieldLabel(path: string): string {
  const question = path.match(questionPath);
  if (question) {
    const [, track, set, index, rest] = question;
    const vars = { track: t(`content.tracks.${track as "reading" | "listening"}`), set, n: Number(index ?? 0) + 1 };
    const place = index === undefined ? t("content.questionSet", vars) : t("content.questionItem", vars);
    return rest ? `${place}، ${fieldLabel(rest)}` : place;
  }
  const turn = path.match(turnPath);
  if (turn) {
    const place = t("content.turnItem", { n: Number(turn[1]) + 1 });
    return turn[2] ? `${place}، ${fieldLabel(turn[2])}` : place;
  }
  const last = path.split(".").pop()?.replace(/\[\d+\]$/, "") ?? path;
  return last in fa.content.fields ? t(`content.fields.${last as FieldKey}`) : last;
}

export function describeProblem(item: Problem, audience: "admin" | "chatbot" = "admin"): string {
  const vars: MessageVars = { ...item.vars };
  if (typeof vars.field === "string") vars.field = audience === "admin" ? fieldLabel(vars.field) : vars.field;
  return t(`content.problems.${item.key}` as MessageKey, vars);
}

/** ["tokens", 3, "surface"] -> "tokens[3].surface" */
export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, part) => {
    if (typeof part === "number") return `${out}[${part}]`;
    return out ? `${out}.${String(part)}` : String(part);
  }, "");
}

function shortValue(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text === undefined ? "" : text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** Turns a Zod error into problems. Parse with `reportInput: true` so missing fields are told apart. */
export function zodProblems(error: z.ZodError, prefix = ""): Problem[] {
  const seen = new Set<string>();
  const problems: Problem[] = [];
  for (const issue of error.issues) {
    const field = formatPath([...(prefix ? [prefix] : []), ...issue.path]) || prefix;
    let item: Problem;
    switch (issue.code) {
      case "invalid_type":
        item = issue.input === undefined || issue.input === null ? problem("missing", { field }) : problem("wrongType", { field });
        break;
      case "invalid_value":
        item = problem("badValue", { field, value: shortValue(issue.input) });
        break;
      case "too_small":
        item =
          issue.origin === "array" && Number(issue.minimum) > 1
            ? problem("tooFew", { field, min: Number(issue.minimum) })
            : problem("missing", { field });
        break;
      case "too_big":
        item = problem("tooMany", { field, max: Number(issue.maximum) });
        break;
      case "invalid_format":
        item = problem("badFormat", { field, value: shortValue(issue.input) });
        break;
      case "invalid_union":
        item = problem("badValue", { field, value: shortValue(issue.input) });
        break;
      default:
        item = problem("wrongType", { field });
    }
    const key = `${item.key}:${field}`;
    if (!seen.has(key)) {
      seen.add(key);
      problems.push(item);
    }
  }
  return problems;
}
