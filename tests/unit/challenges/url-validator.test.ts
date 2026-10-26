import { describe, it, expect } from "vitest";
import {
  validateSubmissionUrl,
  MAX_URL_LENGTH,
  type UrlRejectReason,
} from "@/modules/challenges/url-validator";

const reject = (url: string, reason: UrlRejectReason, opts = {}) => {
  const r = validateSubmissionUrl(url, opts);
  expect(r, url).toEqual({ ok: false, reason });
};

describe("validateSubmissionUrl", () => {
  describe("legitimate URLs", () => {
    it.each([
      "https://example.com",
      "https://example.com/path?q=1",
      "https://sub.domain.example.co.uk/a/b",
      "https://xn--bcher-kva.example/",
      "https://youtu.be/abc123",
    ])("accepts %s", (url) => {
      expect(validateSubmissionUrl(url).ok).toBe(true);
    });

    it("lowercases host and drops fragment", () => {
      const r = validateSubmissionUrl("https://EXAMPLE.com/Path#section");
      expect(r).toMatchObject({ ok: true, host: "example.com" });
      if (r.ok) expect(r.normalized).toBe("https://example.com/Path");
    });

    it("trims surrounding whitespace", () => {
      expect(validateSubmissionUrl("  https://example.com  ").ok).toBe(true);
    });
  });

  describe("schemes", () => {
    it.each([
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com/x",
      "vbscript:msgbox(1)",
      "blob:https://example.com/uuid",
    ])("rejects %s", (url) => reject(url, "bad_scheme"));

    it("rejects http by default, allows when enabled", () => {
      reject("http://example.com", "bad_scheme");
      expect(validateSubmissionUrl("http://example.com", { allowHttp: true }).ok).toBe(true);
    });
  });

  describe("userinfo", () => {
    it.each([
      "https://user:pass@example.com",
      "https://user@example.com",
      "https://example.com@evil.com",
    ])("rejects %s", (url) => {
      const r = validateSubmissionUrl(url);
      expect(r.ok).toBe(false);
    });
    it("reports userinfo reason", () => {
      reject("https://user:pass@example.com", "userinfo");
    });
  });

  describe("SSRF: IP literals", () => {
    it.each([
      "https://127.0.0.1",
      "https://10.0.0.1/admin",
      "https://172.16.0.1",
      "https://172.31.255.255",
      "https://192.168.1.1",
      "https://169.254.169.254/latest/meta-data",
      "https://0.0.0.0",
      "https://8.8.8.8",
      "https://[::1]/",
      "https://[fe80::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://2130706433", // decimal 127.0.0.1
      "https://0x7f000001", // hex
      "https://0177.0.0.1", // octal
      "https://127.1",
    ])("rejects %s", (url) => reject(url, "ip_literal"));
  });

  describe("SSRF: blocked hostnames", () => {
    it.each([
      "https://localhost",
      "https://localhost/",
      "https://LOCALHOST:3000",
      "https://localhost.",
      "https://printer.local",
      "https://db.internal",
      "https://svc.corp.internal/x",
      "https://host.localdomain",
      "https://foo.localhost",
    ])("rejects %s", (url) => reject(url, "blocked_host"));
  });

  describe("host shape", () => {
    it("rejects single-label hosts", () => {
      reject("https://intranet", "not_registrable_domain");
    });
    it("rejects numeric TLD", () => {
      const r = validateSubmissionUrl("https://example.123");
      expect(r.ok).toBe(false);
    });
  });

  describe("syntax and length", () => {
    it("rejects empty", () => {
      reject("", "empty");
      reject("   ", "empty");
    });
    it("rejects garbage", () => {
      reject("not a url", "invalid_url");
      reject("https://", "invalid_url");
    });
    it("rejects embedded whitespace/control chars", () => {
      reject("https://exam ple.com", "invalid_url");
      reject("https://example.com/\u0000", "invalid_url");
      reject("https://example.com/\r\nHost: evil", "invalid_url");
    });
    it("enforces max length", () => {
      const ok = "https://example.com/" + "a".repeat(MAX_URL_LENGTH - 20);
      expect(validateSubmissionUrl(ok).ok).toBe(true);
      reject("https://example.com/" + "a".repeat(MAX_URL_LENGTH), "too_long");
    });
  });

  describe("github field", () => {
    const gh = { field: "github" as const };
    it("accepts owner/repo and canonicalizes", () => {
      const r = validateSubmissionUrl("https://GitHub.com/Octo-Cat/Hello.World/?tab=x#readme", gh);
      expect(r).toMatchObject({ ok: true });
      if (r.ok) expect(r.normalized).toBe("https://github.com/octo-cat/hello.world");
    });
    it("strips .git and trailing slash", () => {
      const r = validateSubmissionUrl("https://github.com/a/b.git/", gh);
      if (r.ok) expect(r.normalized).toBe("https://github.com/a/b");
      expect(r.ok).toBe(true);
    });
    it.each([
      "https://github.com/onlyowner",
      "https://github.com/a/b/tree/main",
      "https://gitlab.com/a/b",
      "https://github.com.evil.com/a/b",
      "https://github.com/-bad/repo",
      "https://github.com/bad-/repo",
      "https://github.com/a/..",
      "https://github.com/a b/c",
      "https://github.com/",
      "http://github.com/a/b",
    ])("rejects %s", (url) => {
      expect(validateSubmissionUrl(url, { ...gh, allowHttp: true }).ok).toBe(false);
    });
  });

  describe("video field", () => {
    const list = ["youtube.com", "youtu.be", "loom.com"];
    const vid = { field: "video" as const, videoHostAllowList: list };
    it("accepts exact and subdomain matches", () => {
      expect(validateSubmissionUrl("https://youtube.com/watch?v=1", vid).ok).toBe(true);
      expect(validateSubmissionUrl("https://www.youtube.com/watch?v=1", vid).ok).toBe(true);
      expect(validateSubmissionUrl("https://youtu.be/x", vid).ok).toBe(true);
    });
    it("rejects lookalikes and others", () => {
      reject("https://evilyoutube.com/x", "host_not_allowed", vid);
      reject("https://youtube.com.evil.com/x", "host_not_allowed", vid);
      reject("https://vimeo.com/1", "host_not_allowed", vid);
    });
    it("no allow-list means any valid host", () => {
      expect(validateSubmissionUrl("https://vimeo.com/1", { field: "video" }).ok).toBe(true);
    });
  });
});
