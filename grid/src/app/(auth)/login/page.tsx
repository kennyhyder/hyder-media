import type { Metadata } from "next";
import AuthForm from "@/components/account/AuthForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to GridCensus to save sites, build lists, set alerts, and claim profiles.",
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md py-8">
      <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>
        Welcome back
      </h1>
      <p className="mt-1 mb-6 text-sm" style={{ color: "var(--muted)" }}>
        Sign in to save sites, build portfolios, and set up alerts across
        164k+ scored locations.
      </p>
      <AuthForm mode="login" />
    </div>
  );
}
