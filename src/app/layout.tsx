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

export const metadata: Metadata = {
    title: 'SMG II DRIVELOGIC',
    description: 'E46 M3 Siemens SMG2 510 — calibration extract and edit. TSUNAGI ///M.',
    manifest: '/manifest.webmanifest',
    applicationName: 'SMG II DRIVELOGIC',
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'SMG II' },
    icons: {
        icon: [
            { url: '/icons/icon.svg', type: 'image/svg+xml' },
            { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        ],
        apple: '/icons/icon-192.png',
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
