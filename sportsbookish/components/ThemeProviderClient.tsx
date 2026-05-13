"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export default function ThemeProviderClient({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
