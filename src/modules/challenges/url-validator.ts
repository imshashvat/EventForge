/**
 * Submission URL validator (ARCHITECTURE §12.2, RULES R-SEC-04/05).
 *
 * Purely syntactic: WHATWG URL parsing + allow/block rules. This module never
 * makes an outbound request.
 */

export const MAX_URL_LENGTH = 2048;

export type UrlField = "generic" | "github" | "video";

export interface UrlValidationOptions {
  field?: UrlField;
  /** Allow plain http (only if the event allows it). Default false. */
  allowHttp?: boolean;
  /** Optional host allow-list for the video field (exact or subdomain match). */
  videoHostAllowList?: readonly string[];
}

export type UrlRejectReason =
  | "empty"
  | "too_long"
  | "invalid_url"
  | "bad_scheme"
  | "userinfo"
  | "ip_literal"
  | "blocked_host"
  | "not_registrable_domain"
  | "invalid_github_url"
  | "host_not_allowed";

export type UrlValidationResult =
  | { ok: true; normalized: string; host: string }
  | { ok: false; reason: UrlRejectReason };

const BLOCKED_HOST_SUFFIXES = [
  ".local",
  ".internal",
  ".localdomain",
  ".localhost",
  ".lan",
  ".home.arpa",
] as const;

const GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

const fail = (reason: UrlRejectReason): UrlValidationResult => ({
  ok: false,
  reason,
});

/** True for dotted-quad-like hosts, including decimal/hex/octal tricks. */
function looksLikeIpv4(host: string): boolean {
  // WHATWG normalizes most numeric forms to dotted-quad, but guard anyway.
  if (/^\d+$/.test(host)) return true;
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  const labels = host.split(".");
  if (labels.length >= 1 && labels.length <= 4) {
    return labels.every((l) => /^(\d+|0x[0-9a-f]+)$/i.test(l));
  }
  return false;
}

export function validateSubmissionUrl(
  input: string,
  options: UrlValidationOptions = {},
): UrlValidationResult {
  const { field = "generic", allowHttp = false, videoHostAllowList } = options;

  if (typeof input !== "string") return fail("invalid_url");
  const raw = input.trim();
  if (raw.length === 0) return fail("empty");
  if (raw.length > MAX_URL_LENGTH) return fail("too_long");
  // Control characters / whitespace inside the URL are never legitimate.
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return fail("invalid_url");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("invalid_url");
  }

  // Scheme
  const scheme = url.protocol;
  if (scheme !== "https:" && !(allowHttp && scheme === "http:")) {
    return fail("bad_scheme");
  }

  // Userinfo
  if (url.username !== "" || url.password !== "") return fail("userinfo");

  // Host
  const host = url.hostname.toLowerCase();
  if (host.length === 0) return fail("invalid_url");

  // IPv6 literals are bracketed by the WHATWG parser.
  if (host.startsWith("[") || host.includes(":")) return fail("ip_literal");
  if (looksLikeIpv4(host)) return fail("ip_literal");

  // Trailing dot is an FQDN form; strip for comparison.
  const bare = host.endsWith(".") ? host.slice(0, -1) : host;

  if (bare === "localhost") return fail("blocked_host");
  if (BLOCKED_HOST_SUFFIXES.some((s) => bare.endsWith(s))) {
    return fail("blocked_host");
  }

  // Must be a registrable-looking domain: at least two labels, valid TLD.
  const labels = bare.split(".");
  if (labels.length < 2 || labels.some((l) => l.length === 0)) {
    return fail("not_registrable_domain");
  }
  const tld = labels[labels.length - 1] as string;
  // Reject numeric TLDs (IP-ish) and single-char / malformed TLDs.
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(tld)) {
    return fail("not_registrable_domain");
  }

  // Fragment is dropped; normalize.
  url.hash = "";
  const normalized = url.toString();

  if (field === "github") {
    if (bare !== "github.com" || scheme !== "https:") {
      return fail("invalid_github_url");
    }
    const parts = url.pathname.split("/").filter((p) => p.length > 0);
    if (parts.length !== 2) return fail("invalid_github_url");
    const owner = parts[0] as string;
    const repoRaw = parts[1] as string;
    const repo = repoRaw.endsWith(".git") ? repoRaw.slice(0, -4) : repoRaw;
    if (
      !GITHUB_OWNER_RE.test(owner) ||
      owner.endsWith("-") ||
      !GITHUB_REPO_RE.test(repo) ||
      repo === "." ||
      repo === ".."
    ) {
      return fail("invalid_github_url");
    }
    // Canonical form for duplicate detection: lowercase owner/repo, no query.
    const canonical = `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
    return { ok: true, normalized: canonical, host: bare };
  }

  if (field === "video" && videoHostAllowList && videoHostAllowList.length > 0) {
    const allowed = videoHostAllowList.some((h) => {
      const a = h.toLowerCase();
      return bare === a || bare.endsWith(`.${a}`);
    });
    if (!allowed) return fail("host_not_allowed");
  }

  return { ok: true, normalized, host: bare };
}
