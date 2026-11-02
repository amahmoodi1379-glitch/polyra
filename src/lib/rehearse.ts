/**
 * «آزمایش مثل زبان‌آموز» in the panel (DECISIONS.md, 2 November 2026): the made-up learners a teacher
 * can play on their own account. Shared by the page and the server; the Persian names and
 * descriptions are under `admin.rehearse.scenarios` in fa.json.
 *
 * `days` days are played, the last one yesterday, so today is the day the teacher looks. On each day
 * `sessions(day)` mixed sessions are played with the simulator's learner of that `ability` (PRD §16.3);
 * `cap` answers the word-cap question.
 */
export type ScenarioId = "fresh" | "week" | "month" | "texts" | "mistakes" | "irregular" | "returning" | "eager";

export type Scenario = {
  id: ScenarioId;
  days: number;
  ability: number;
  sessions: (day: number) => number;
  cap: "more" | "none";
};

const daily = (count: number) => () => count;

export const SCENARIOS: Scenario[] = [
  { id: "fresh", days: 0, ability: 0.8, sessions: daily(0), cap: "none" },
  { id: "week", days: 7, ability: 0.85, sessions: daily(1), cap: "none" },
  { id: "month", days: 30, ability: 0.85, sessions: daily(1), cap: "none" },
  // Three weeks, two sessions a day: texts in both tracks at every attempt (PRD §7.4, §10.11).
  { id: "texts", days: 21, ability: 0.85, sessions: daily(2), cap: "none" },
  { id: "mistakes", days: 10, ability: 0.45, sessions: daily(1), cap: "none" },
  // Three days a week for three weeks.
  { id: "irregular", days: 21, ability: 0.8, sessions: (day) => (day % 7 === 0 || day % 7 === 2 || day % 7 === 4 ? 1 : 0), cap: "none" },
  // Two weeks every day, then thirty days away.
  { id: "returning", days: 44, ability: 0.8, sessions: (day) => (day < 14 ? 1 : 0), cap: "none" },
  // Ten days, three sessions a day, always «۱۰ تای دیگر».
  { id: "eager", days: 10, ability: 0.9, sessions: daily(3), cap: "more" },
];

export const scenarioById = (id: string): Scenario | undefined => SCENARIOS.find((scenario) => scenario.id === id);

/** Sessions the scenario plays in all, for the page's «حدود … جلسه». */
export const scenarioSessions = (scenario: Scenario) => Array.from({ length: scenario.days }, (_, day) => scenario.sessions(day)).reduce((a, b) => a + b, 0);
