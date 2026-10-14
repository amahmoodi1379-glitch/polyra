import type { Gender } from "@/engine/content";

/** The class that colours an article by its gender (DESIGN.md, «Gender»); usable on server pages too. */
export const genderClass = (gender: Gender | null) =>
  gender === "m" || gender === "der" ? "g-m" : gender === "f" || gender === "die" ? "g-f" : gender === "das" ? "g-n" : gender === "mf" ? "g-x" : undefined;
