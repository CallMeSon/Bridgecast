import type { ReactNode } from 'react'

import { Geist, Geist_Mono } from 'next/font/google'
import type { Metadata } from 'next'

import { ThemeProvider } from '@/components/theme-provider'

import { cn } from '@/lib/utils'

import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin']
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin']
})

const description =
  'Download Bridgecast for Windows, macOS and Linux, and see what changed in every release.'

export const metadata: Metadata = {
  title: {
    template: '%s | Bridgecast',
    default: 'Bridgecast: downloads and release notes'
  },
  description,
  robots: 'index,follow',
  keywords: ['Bridgecast', 'live events', 'presentation', 'NDI', 'OMT', 'release notes'],
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  openGraph: {
    title: 'Bridgecast: downloads and release notes',
    description,
    type: 'website',
    siteName: 'Bridgecast'
  }
}

const RootLayout = ({ children }: Readonly<{ children: ReactNode }>) => {
  return (
    <html
      lang='en'
      className={cn(geistSans.variable, geistMono.variable, 'flex min-h-full w-full scroll-smooth antialiased')}
      suppressHydrationWarning
    >
      <body className='flex min-h-full w-full flex-auto flex-col'>
        <ThemeProvider attribute='class' defaultTheme='system' enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}

export default RootLayout
