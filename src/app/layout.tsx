import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { TopBar } from "@/components/topbar";

export const metadata: Metadata = {
  title: "Tarang — call intelligence",
  description:
    "A working prototype: a voice agent takes D2C support calls, and every call is turned into structured, queryable product insight.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Set the theme before first paint so a dark-mode reader never gets a
          white flash. Inline because it must run before React hydrates.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("tarang.theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <StoreProvider>
          <TopBar />
          <main className="shell">{children}</main>
        </StoreProvider>
      </body>
    </html>
  );
}
