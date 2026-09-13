import type { PackageSource } from "@earendil-works/pi-coding-agent";

// Extension packages as Pi's settings record them. A `packages` entry is
// either a bare source string or an object that filters which resources of
// the package load; disabling one is expressed as an object whose four
// resource lists are empty, which is also how Pi's own CLI spells it.

export type PackageScope = "user" | "project";

export type PackageStatus = "disabled" | "loaded" | "installed" | "missing";

export type PackageResource = {
  kind: "extensions" | "skills" | "prompts" | "themes";
  /** The name a reader recognises: the folder for `SKILL.md` and `index.ts`. */
  name: string;
  /** Relative to the package when it sits inside it, else absolute. */
  relativePath: string;
  path: string;
};

export type PackageInfo = {
  source: string;
  scope: PackageScope;
  status: PackageStatus;
  /** Object form with some, but not all, resource lists set. */
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  resources: PackageResource[];
};

export type PackageDiagnostic = {
  type: "warning" | "error";
  message: string;
  source?: string;
};

export type PackagesView = {
  packages: PackageInfo[];
  totals: {
    extensions: number;
    skills: number;
    prompts: number;
    themes: number;
  };
  diagnostics: PackageDiagnostic[];
  projectResourcesLoaded: boolean;
};

export const PACKAGE_ACTIONS = [
  "install",
  "remove",
  "update",
  "enable",
  "disable",
] as const;

export type PackageAction = (typeof PACKAGE_ACTIONS)[number];

export function isPackageAction(value: string): value is PackageAction {
  return (PACKAGE_ACTIONS as readonly string[]).includes(value);
}

const KINDS = ["extensions", "skills", "prompts", "themes"] as const;

export function packageSourceOf(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

/** All four resource lists present and empty: the package loads nothing. */
export function isDisabledPackage(entry: PackageSource): boolean {
  if (typeof entry === "string") return false;
  return KINDS.every((kind) => {
    const list = entry[kind];
    return Array.isArray(list) && list.length === 0;
  });
}

/** Some lists set, but not the all-empty disabled shape. */
export function isFilteredPackage(entry: PackageSource): boolean {
  if (typeof entry === "string") return false;
  if (isDisabledPackage(entry)) return false;
  return KINDS.some((kind) => Array.isArray(entry[kind]));
}

/**
 * Disabling keeps the object form and merges the empty lists in; enabling
 * writes the plain source string back, which is why **any per-resource
 * filters an entry carried are lost when it is re-enabled** — the same
 * trade-off pi-web makes, and the reason the UI says so.
 *
 * Null means no entry matched: nothing to write.
 */
export function setPackageDisabled(
  packages: readonly PackageSource[],
  source: string,
  disabled: boolean,
): PackageSource[] | null {
  let matched = false;
  const next = packages.map((entry): PackageSource => {
    if (packageSourceOf(entry) !== source) return entry;
    matched = true;
    if (!disabled) return source;
    const base = typeof entry === "string" ? { source } : { ...entry };
    return { ...base, extensions: [], skills: [], prompts: [], themes: [] };
  });
  return matched ? next : null;
}

/** The version or ref pinned in the source string, when it carries one. */
export function configuredVersion(source: string): string | undefined {
  if (source.startsWith("npm:")) {
    const spec = source.slice(4);
    // A scoped package's leading `@` is part of the name, not a version.
    const at = spec.lastIndexOf("@");
    if (at <= 0) return undefined;
    const version = spec.slice(at + 1);
    return version === "" ? undefined : version;
  }
  const at = source.lastIndexOf("@");
  if (at <= 0) return undefined;
  const ref = source.slice(at + 1);
  // `git@github.com:owner/repo` is a host, not a ref.
  if (ref === "" || ref.includes("/") || ref.includes(":")) return undefined;
  return ref;
}

export function packageStatus(input: {
  disabled: boolean;
  resources: number;
  installedPath?: string;
}): PackageStatus {
  if (input.disabled) return "disabled";
  if (input.resources > 0) return "loaded";
  return input.installedPath === undefined ? "missing" : "installed";
}

/** `SKILL.md` and `index.ts` are named by their folder, not by themselves. */
export function resourceLabel(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/");
  const file = parts.at(-1) ?? path;
  const parent = parts.at(-2) ?? "";
  if (/^skill\.md$/i.test(file) || /^index\.[cm]?[jt]s$/i.test(file)) {
    return parent === "" ? file : parent;
  }
  return file.replace(/\.[^.]+$/, "");
}

export function relativeResource(path: string, baseDir?: string): string {
  if (baseDir === undefined || baseDir === "") return path;
  const base = baseDir.replaceAll("\\", "/").replace(/\/+$/, "");
  const target = path.replaceAll("\\", "/");
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : path;
}

export function resourceTotals(
  packages: readonly PackageInfo[],
): PackagesView["totals"] {
  const totals = { extensions: 0, skills: 0, prompts: 0, themes: 0 };
  for (const info of packages) {
    for (const resource of info.resources) totals[resource.kind] += 1;
  }
  return totals;
}
