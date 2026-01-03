import type { Metadata, Viewport } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/contexts/AppContext";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { SocketProvider } from "@/contexts/SocketContext";

const outfit = Outfit({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sudoku Arena — Competitive Puzzle Gaming",
  description: "Master the art of Sudoku. Compete against players worldwide, challenge AI opponents, and win in professional tournaments.",
  keywords: ["sudoku", "puzzle game", "competitive gaming", "multiplayer", "tournaments", "brain training"],
  authors: [{ name: "Sudoku Arena" }],
  creator: "Sudoku Arena",
  openGraph: {
    title: "Sudoku Arena — Competitive Puzzle Gaming",
    description: "Master the art of Sudoku. Compete against players worldwide.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FCFCFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1419" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body
        className={`${outfit.variable} ${jetbrainsMono.variable} font-sans min-h-full bg-background text-foreground antialiased`}
      >
        <AuthProvider>
          <AppProvider>
            <SocketProvider>
              <div className="flex min-h-screen flex-col">
                {children}
              </div>
            </SocketProvider>
          </AppProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
