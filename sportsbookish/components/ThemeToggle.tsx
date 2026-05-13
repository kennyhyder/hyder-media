"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Avoid hydration mismatch — render neutral placeholder until mounted
  if (!mounted) {
    return (
      <Button variant="ghost" size={compact ? "sm" : "default"} aria-label="Theme">
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const cycle = () => {
    if (theme === "system") setTheme("light");
    else if (theme === "light") setTheme("dark");
    else setTheme("system");
  };

  const icon =
    theme === "system" ? <Monitor className="h-4 w-4" /> :
    resolvedTheme === "dark" ? <Moon className="h-4 w-4" /> :
    <Sun className="h-4 w-4" />;

  return (
    <Button
      onClick={cycle}
      variant="ghost"
      size={compact ? "sm" : "default"}
      title={`Theme: ${theme} (${resolvedTheme})`}
      aria-label={`Theme: ${theme}`}
    >
      {icon}
    </Button>
  );
}
