/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public URL of the optional narration function (api/), e.g. https://<app>.azurewebsites.net/api/narrate. Not a secret. */
  readonly VITE_NARRATION_URL?: string;
  /** Base path of the deployed site (GitHub Pages: /football/). */
  readonly VITE_BASE?: string;
}
