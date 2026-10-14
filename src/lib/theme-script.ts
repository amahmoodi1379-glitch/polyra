/** Where the learner app keeps this device's preferences (`src/components/learn/prefs.ts`). */
export const PREFS_KEY = "polyra.prefs";

/** Runs before the page paints (in the root layout), so a chosen theme never flashes the other one. */
export const themeScript = `try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)})||"{}");if(p.theme==="light"||p.theme==="dark")document.documentElement.setAttribute("data-theme",p.theme)}catch(e){}`;
