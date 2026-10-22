/**
 * Interface language. English is the default (the hackathon jury, the submission), German stays available
 * (`?lang=de` or the start screen). Every on-screen text is written in both languages at the place it is made, so a
 * sentence and its translation never drift apart. The simulation worker gets the language with its config, so texts
 * the orchestrator writes there (options, situations) are in the same language as the page.
 */
export type Lang = 'en' | 'de';

let current: Lang = 'en';

export function setLang(lang: Lang): void {
  current = lang;
}

export function lang(): Lang {
  return current;
}

/** The text in the current language. */
export function tr(en: string, de: string): string {
  return current === 'de' ? de : en;
}

/** A language from a URL parameter or stored choice; anything else is English. */
export function parseLang(value: string | null | undefined): Lang {
  return value === 'de' ? 'de' : 'en';
}
