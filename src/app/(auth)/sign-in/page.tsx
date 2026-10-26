import { type Metadata } from "next";
import SignInForm from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your EventForge account to access events and competitions.",
};

interface Props {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function SignInPage({ searchParams }: Props) {
  const { next, error } = await searchParams;

  return (
    <div style={{ width: "100%", maxWidth: "440px" }}>
      {/* Brand — Georgia serif wordmark, no icon mark */}
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontSize: "24px",
            fontWeight: 400,
            color: "var(--text)",
            marginBottom: "4px",
          }}
        >
          EventForge
        </h1>
        <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>
          Sign in to continue
        </p>
      </div>

      {/* Form panel — radius 0, no shadow, 1px border */}
      <div
        style={{
          border: "1px solid var(--border)",
          padding: "32px",
          background: "var(--surface)",
        }}
      >
        {/* URL error param */}
        {error && (
          <div
            style={{
              marginBottom: "20px",
              borderLeft: "2px solid var(--bad)",
              paddingLeft: "12px",
              paddingTop: "8px",
              paddingBottom: "8px",
              fontSize: "14px",
              color: "var(--bad)",
            }}
            role="alert"
          >
            {decodeURIComponent(error)}
          </div>
        )}

        <SignInForm {...(next ? { next } : {})} />

        <p
          style={{
            marginTop: "20px",
            textAlign: "center",
            fontSize: "14px",
            color: "var(--text-muted)",
          }}
        >
          Don&apos;t have an account?{" "}
          <a href="/sign-up" style={{ color: "var(--text)", textDecorationLine: "underline" }}>
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}
