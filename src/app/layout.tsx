import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/inter-tight';
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/app.css';
import '@/styles/public.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'Counterbill — question the charge, build your case', template: '%s · Counterbill' },
  description:
    'Counterbill compares a freight invoice with the quote, packing list and survey behind it, recalculates the difference, shows what is still unproven, and drafts a complaint you review and send yourself. It does not give legal advice.',
  applicationName: 'Counterbill',
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }] },
  openGraph: {
    title: 'Counterbill — question the charge, build your case',
    description: 'Compare freight records, recalculate the charge, and revise your complaint as new evidence arrives.',
    type: 'website',
    siteName: 'Counterbill',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

// Applies the saved theme before first paint so there is no flash.
const themeScript = `document.documentElement.classList.add('js');try{var t=localStorage.getItem('cb-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`;

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
