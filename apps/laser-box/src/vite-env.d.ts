/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Stamped into the cut file's provenance by a release build; absent in dev. */
  readonly VITE_BUILD_ID?: string;
}
