import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "AgentPurse",
  description: "Give your AI an allowance, not your credit card.",
};

// Runs before first paint so the saved (or OS) theme applies with no flash.
// Storage access is wrapped in try/catch because it can be blocked.
const THEME_SCRIPT = `(function(){var t=null;try{t=localStorage.getItem("ap-theme")}catch(e){}if(t!=="light"&&t!=="dark"){t="dark";try{if(window.matchMedia("(prefers-color-scheme: light)").matches)t="light"}catch(e){}}document.documentElement.setAttribute("data-theme",t)})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={inter.variable}
      suppressHydrationWarning
    >
      <head>
        <script>{THEME_SCRIPT}</script>
      </head>
      <body>{children}</body>
    </html>
  );
}
