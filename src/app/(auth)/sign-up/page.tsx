import { type Metadata } from "next";
import SignUpForm from "./sign-up-form";

export const metadata: Metadata = {
  title: "Get Started",
  description: "Create your free EventForge account to participate in events and competitions.",
};

export default function SignUpPage() {
  return (
    <div style={{ width: "100%", maxWidth: "440px" }}>
      {/* Brand — Georgia serif, no icon mark */}
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
          Join EventForge
        </h1>
        <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>
          Create your free account
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
        <SignUpForm />

        <p
          style={{
            marginTop: "20px",
            textAlign: "center",
            fontSize: "14px",
            color: "var(--text-muted)",
          }}
        >
          Already have an account?{" "}
          <a href="/sign-in" style={{ color: "var(--text)", textDecorationLine: "underline" }}>
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
