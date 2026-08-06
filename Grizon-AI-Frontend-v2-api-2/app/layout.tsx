import type { Metadata, Viewport } from "next";
import {
  Inter,
  JetBrains_Mono,
  Bricolage_Grotesque,
  Geist,
  DM_Sans,
  Space_Grotesk,
  Sora,
  Plus_Jakarta_Sans,
  IBM_Plex_Sans,
  Nunito,
  Outfit,
} from "next/font/google";

import "./globals.css";
import { GlobalMetadata } from "./GlobalMetadata";
import { ThemeProvider } from "../context/ThemeContext";
import { AuthProvider } from "../context/AuthContext";
import { ConversationProvider } from "../context/ConversationContext";
import { ModelProvider } from "../context/ModelContext";
import { CreditProvider } from "../context/CreditContext";
import { CanvasProvider } from "../context/CanvasContext";

// Applied before first paint to avoid a flash of the default theme.
const THEME_INIT_SCRIPT = `
  (function() {
    try {
      var t = localStorage.getItem('grizon_theme');
      var valid = { midnight: 1, daylight: 1, twilight: 1, parchment: 1 };
      document.documentElement.setAttribute('data-theme', valid[t] ? t : 'midnight');
    } catch (e) {
      document.documentElement.setAttribute('data-theme', 'midnight');
    }
  })();
`;

const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500"],
});


const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap", weight: ["300", "400", "500", "600", "700"] });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap", weight: ["300", "400", "500", "600", "700"] });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap", weight: ["300", "400", "500", "600", "700"] });
const plusJakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-plus-jakarta", display: "swap", weight: ["300", "400", "500", "600", "700"] });
const ibmPlex = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-ibm-plex", display: "swap", weight: ["300", "400", "500", "600"] });
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito", display: "swap", weight: ["300", "400", "500", "600", "700"] });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap", weight: ["300", "400", "500", "600", "700"] });

export const metadata: Metadata = GlobalMetadata;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1.0,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Geist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var suppress = function(e) {
              var r = e.reason || e.error;
              if (r && typeof r === 'object' && !(r instanceof Error)) {
                e.preventDefault();
                e.stopImmediatePropagation();
              } else if (!r && e.type === 'unhandledrejection') {
                e.preventDefault();
                e.stopImmediatePropagation();
              }
            };
            window.addEventListener('unhandledrejection', suppress, true);
            window.addEventListener('error', suppress, true);
          })();
        `}} />
      </head>

      <body
        className={`${bricolageGrotesque.variable} ${geist.variable} ${inter.variable} ${jetbrainsMono.variable} ${dmSans.variable} ${spaceGrotesk.variable} ${sora.variable} ${plusJakarta.variable} ${ibmPlex.variable} ${nunito.variable} ${outfit.variable} font-sans h-screen min-h-screen bg-paper text-ink antialiased`}
        suppressHydrationWarning
      >

        <ThemeProvider>
          <AuthProvider>
            <ConversationProvider>
              <ModelProvider>
                <CreditProvider>
                  <CanvasProvider>
                    {children}
                  </CanvasProvider>
                </CreditProvider>
              </ModelProvider>
            </ConversationProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
