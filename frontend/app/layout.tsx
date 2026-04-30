import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "MarylandIQ - Maryland Voter Research for Local Elections",
    template: "%s | MarylandIQ",
  },
  description:
    "Free, sourced voter research for Maryland local elections: school board, county council, sheriff, and more. Find any candidate, any county. No account required.",
  metadataBase: new URL("https://marylandiq.org"),
  openGraph: {
    siteName: "MarylandIQ",
    type: "website",
    locale: "en_US",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-[#0F172A]">

        {/* Skip to main content — WCAG 2.1 AA */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-[#0F172A] focus:rounded-md focus:shadow-lg focus:text-sm focus:font-semibold focus:ring-4 focus:ring-[#CC0000] focus:outline-none"
        >
          Skip to main content
        </a>

        {/* Google AdSense */}
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3804213779492333"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />

        {/* Google Ads conversion tracking */}
        <Script
          async
          src="https://www.googletagmanager.com/gtag/js?id=AW-18128744001"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">{`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'AW-18128744001');
        `}</Script>

        <Header />

        <div id="main-content" className="flex flex-col flex-1">
          {children}
        </div>

        <Footer />
        <Analytics />

      </body>
    </html>
  );
}
