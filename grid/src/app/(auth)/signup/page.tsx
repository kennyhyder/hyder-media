import type { Metadata } from "next";
import AuthForm from "@/components/account/AuthForm";

export const metadata: Metadata = {
  title: "Create a free account",
  description:
    "Create a free GridCensus account to save sites, build lists, set alerts, claim profiles, and get a read-only API key.",
  robots: { index: false, follow: true },
};

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-md py-8">
      <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>
        Create your free account
      </h1>
      <p className="mt-1 mb-6 text-sm" style={{ color: "var(--muted)" }}>
        Free forever: save candidate sites, build portfolios, set alerts,
        suggest edits, and get a read-only API key.
      </p>
      <AuthForm mode="signup" />
    </div>
  );
}
