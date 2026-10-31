import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'Counterbill — build the case when a freight bill does not add up', template: '%s · Counterbill' },
  description:
    'Counterbill compares your freight invoice with your quotes, packing lists and surveys, recalculates the difference, shows what is still unproven, and drafts a reviewable complaint letter. It does not give legal advice or send anything for you.',
  applicationName: 'Counterbill',
  openGraph: {
    title: 'Counterbill — build the case when a freight bill does not add up',
    description: 'Concurrent AI agents compare freight records, recalculate volume charges and revise the complaint when new evidence arrives.',
    type: 'website',
    siteName: 'Counterbill',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f4ef' },
    { media: '(prefers-color-scheme: dark)', color: '#11151b' },
  ],
};

// Applies the saved theme before first paint so there is no flash.
const themeScript = `try{var t=localStorage.getItem('cb-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
