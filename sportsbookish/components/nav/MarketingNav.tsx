import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { LineChart } from "lucide-react";

export default function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <LineChart className="h-5 w-5 text-emerald-500" />
          <span className="text-lg tracking-tight">SportsBookish</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/pricing" className={buttonVariants({ variant: "ghost", size: "sm" })}>Pricing</Link>
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>Log in</Link>
          <Link href="/signup" className={`${buttonVariants({ size: "sm" })} bg-emerald-600 hover:bg-emerald-500 text-white`}>Start free</Link>
        </nav>
      </div>
    </header>
  );
}
