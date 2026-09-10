import {
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";

/**
 * Opening a repository must not run its `.pi/extensions` code. The SDK only
 * imports project resources once `resolveProjectTrust` says yes, and Pi's own
 * terminal shares the trust store, so a decision made there applies here.
 */
export function projectTrustReloadOptions(
  cwd: string,
  agentDir: string,
): { resolveProjectTrust: () => Promise<boolean> } | undefined {
  if (!hasTrustRequiringProjectResources(cwd)) return undefined;
  const store = new ProjectTrustStore(agentDir);
  return {
    resolveProjectTrust: () => Promise.resolve(store.get(cwd) === true),
  };
}
