/// <reference types="vite/client" />

/**
 * Vite's `?worker` imports return a Worker constructor. Monaco's language services all
 * run in workers, and bundling them through Vite rather than an AMD loader is what keeps
 * the CSP free of `unsafe-eval`.
 */
declare module "*?worker" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
