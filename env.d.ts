declare namespace NodeJS {
  interface ProcessEnv {
    /** Injected into the client bundle by next.config.ts. */
    readonly NEXT_PUBLIC_APP_VERSION?: string;
  }
}
