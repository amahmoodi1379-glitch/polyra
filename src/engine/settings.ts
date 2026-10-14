/**
 * Engine numbers (PRD §9.8). The engine never holds a number of its own: the server reads every key
 * from `engine_setting` and passes them in as this object. Reading a key that is missing is a bug, so
 * it throws instead of falling back to a guess.
 */
export type SettingValue = number | boolean | number[] | null;
export type Settings = Readonly<Record<string, SettingValue>>;

export function num(settings: Settings, key: string): number {
  const value = settings[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Engine setting ${key} is not a number`);
  return value;
}

/** A number the admin may leave empty (for example `new.first_interval_days`). */
export function optionalNum(settings: Settings, key: string): number | null {
  const value = settings[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Engine setting ${key} is not a number`);
  return value;
}

export function flag(settings: Settings, key: string): boolean {
  const value = settings[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  throw new Error(`Engine setting ${key} is not on or off`);
}

/** FSRS weights; null means the library's own defaults. */
export function weights(settings: Settings): number[] | null {
  const value = settings["fsrs.weights"];
  return Array.isArray(value) && value.length > 0 ? value : null;
}

/** Whether an exercise code is switched on in the panel. Codes without a switch are always on. */
export function exerciseOn(settings: Settings, code: string): boolean {
  const value = settings[`exercise.${code}.enabled`];
  return value === undefined || value === null ? true : flag(settings, `exercise.${code}.enabled`);
}
