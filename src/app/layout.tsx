import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Two families, split by meaning: Inter for UI chrome, JetBrains Mono for machine data
// (addresses, raw bytes, table cells, hashes, part numbers). Both are exposed as CSS variables
// that globals.css maps onto Tailwind's --font-sans / --font-mono, so the utilities resolve.
// JetBrains Mono is chosen for its tall x-height and slashed zero, which stay legible at the
// 8-10px sizes an address column renders at.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' });

/**
 * The PRODUCTION identity, and only that. A preview build is this same export with its names,
 * icons and `app-variant` rewritten by `scripts/brand-preview.mjs` — so nothing here may name an
 * environment. The icons are the M ICON `mapping` set (tsunagi-m-release §4), written by
 * tsunagi-m3's `scripts/m-icons.mjs`; the preview swaps each for its `-dev-` twin.
 *
 * No `appleWebApp.title`: left unset, iOS falls back to the manifest's `short_name`, so the home
 * screen label is decided in one place — the one brand-preview rewrites.
 */
export const metadata: Metadata = {
    title: 'E46M3SMG2 /// MAPPING',
    description: 'E46 M3 Siemens SMG2 510 — calibration extract and edit. TSUNAGI ///M.',
    manifest: '/manifest.webmanifest',
    applicationName: 'E46M3SMG2 /// MAPPING',
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent' },
    icons: {
        icon: [
            { url: '/icons/mapping-32.png', sizes: '32x32', type: 'image/png' },
            { url: '/icons/mapping-192.png', sizes: '192x192', type: 'image/png' },
        ],
        apple: '/icons/mapping-256.png',
    },
};

export const viewport: Viewport = {
    colorScheme: 'dark',
    themeColor: '#000000',
    width: 'device-width',
    initialScale: 1,
    // Pinch-zoom stays available: this app renders 10px mono tables of hex, and taking zoom away
    // from a reader squinting at a phone in a garage would be a real loss. `viewportFit` is
    // deliberately NOT 'cover' — the header would slide under the notch.
    maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ja">
            <body
                className={`${inter.variable} ${jetbrainsMono.variable} ${inter.className} ` +
                    `bg-slate-950 text-slate-100 min-h-[100svh]`}
            >
                {children}
            </body>
        </html>
    );
}
