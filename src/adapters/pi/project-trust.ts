import type { ProjectTrust } from "@core/ports";
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

/**
 * Trust as the whole app asks about it. A decision recorded for a parent
 * folder covers its children: the store walks up and takes the nearest one.
 */
export function createPiProjectTrust(options: {
  agentDir: string;
}): ProjectTrust {
  return {
    status(cwd) {
      if (!hasTrustRequiringProjectResources(cwd)) {
        return Promise.resolve({ requiresTrust: false, trusted: true });
      }
      const store = new ProjectTrustStore(options.agentDir);
      return Promise.resolve({
        requiresTrust: true,
        trusted: store.get(cwd) === true,
      });
    },
    trust(cwd) {
      // Nothing to trust means nothing to write: a folder without project
      // resources must not collect an entry in Pi's store.
      if (!hasTrustRequiringProjectResources(cwd)) return Promise.resolve();
      new ProjectTrustStore(options.agentDir).set(cwd, true);
      return Promise.resolve();
    },
  };
}
