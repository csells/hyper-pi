/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HYPI_TOKEN: string;
  readonly VITE_HYPIVISOR_PORT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
