/** Content identity captured at process startup or read from an installation. */
export function installationIdentity(root: string): { root: string; mode: "source" | "package"; version: string; fingerprint: string };
