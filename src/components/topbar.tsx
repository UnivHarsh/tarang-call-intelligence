"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL;

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/signals", label: "Signals" },
  { href: "/calls", label: "Calls" },
  { href: "/live", label: "Live demo" },
  { href: "/ask", label: "Ask" },
  { href: "/how", label: "How it works" },
];

function Mark() {
  // Three rising waves — the name means "wave".
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="9" width="3" height="6" rx="1.5" fill="var(--series-1)" opacity="0.45" />
      <rect x="7" y="5" width="3" height="14" rx="1.5" fill="var(--series-1)" opacity="0.7" />
      <rect x="12" y="2" width="3" height="20" rx="1.5" fill="var(--series-1)" />
      <rect x="17" y="7" width="3" height="10" rx="1.5" fill="var(--series-1)" opacity="0.55" />
    </svg>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const stored = (localStorage.getItem("tarang.theme") as "light" | "dark" | null) ?? null;
    setTheme(stored);
  }, []);

  const toggle = () => {
    const isDark =
      document.documentElement.getAttribute("data-theme") === "dark" ||
      (!document.documentElement.getAttribute("data-theme") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("tarang.theme", next);
    setTheme(next);
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          <Mark />
          Tarang
        </Link>

        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} data-active={pathname === l.href}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {REPO_URL && (
            <a className="chip" href={REPO_URL} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
          <button
            className="btn"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            style={{ padding: "6px 10px" }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
