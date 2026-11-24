import type { ReactNode } from 'react'

import { DownloadIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

import { formatSize } from '@/lib/releases'
import type { Download, Platform } from '@/lib/releases'

type Option = { platform: Platform; label: string }

type Target = {
  os: string
  requires: string
  options: Option[]
  notes: string[]
}

const TARGETS: Target[] = [
  {
    os: 'Windows',
    requires: 'Windows 10 or 11, 64-bit',
    options: [{ platform: 'windows', label: 'Installer (.exe)' }],
    notes: [
      'Updates itself when a new version is out.',
      'PowerPoint files need PowerPoint installed; they play as a real slide show.'
    ]
  },
  {
    os: 'macOS',
    requires: 'macOS 12 or later',
    options: [
      { platform: 'macArm64', label: 'Apple silicon (.dmg)' },
      { platform: 'macX64', label: 'Intel (.dmg)' }
    ],
    notes: [
      'Not signed yet: the first time, right-click the app and choose Open.',
      'Does not update itself. PowerPoint files are converted to PDF on import with Keynote or LibreOffice (no animations). No OMT output.'
    ]
  },
  {
    os: 'Linux',
    requires: '64-bit (x86-64)',
    options: [
      { platform: 'appImage', label: 'AppImage' },
      { platform: 'deb', label: 'Debian / Ubuntu (.deb)' }
    ],
    notes: [
      'The AppImage updates itself; the .deb does not.',
      'PowerPoint files need LibreOffice Impress and python3-uno.'
    ]
  }
]

const DownloadButton = ({ download, children }: { download?: Download; children: ReactNode }) => {
  if (!download) {
    return (
      <Button variant='outline' className='h-auto w-full flex-wrap justify-between gap-x-3 gap-y-1 rounded-lg py-2 whitespace-normal' disabled>
        {children}
        <span className='text-xs'>Not available yet</span>
      </Button>
    )
  }

  return (
    <Button variant='outline' className='h-auto w-full flex-wrap justify-between gap-x-3 gap-y-1 rounded-lg py-2 whitespace-normal' asChild>
      <a href={download.url}>
        <span className='inline-flex items-center gap-2'>
          <DownloadIcon className='size-4' />
          {children}
        </span>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {download.version} · {formatSize(download.size)}
        </span>
      </a>
    </Button>
  )
}

function DownloadSection({ downloads }: { downloads: Partial<Record<Platform, Download>> }) {
  return (
    <section id='download' className='scroll-mt-18 py-8 sm:py-10 lg:py-16'>
      <div className='mx-auto max-w-5xl px-4 sm:px-6 lg:px-8'>
        <div className='mb-10 space-y-4 text-center'>
          <h2 className='text-2xl font-semibold md:text-3xl lg:text-4xl'>Download</h2>
          <p className='text-muted-foreground text-xl'>For Windows, macOS and Linux.</p>
        </div>

        <div className='grid gap-6 md:grid-cols-3'>
          {TARGETS.map(target => (
            <Card key={target.os} className='flex flex-col'>
              <CardHeader>
                <CardTitle className='text-xl'>{target.os}</CardTitle>
                <CardDescription>{target.requires}</CardDescription>
              </CardHeader>
              <CardContent className='flex flex-col gap-3'>
                {target.options.map(option => (
                  <DownloadButton key={option.platform} download={downloads[option.platform]}>
                    {option.label}
                  </DownloadButton>
                ))}
              </CardContent>
              <CardFooter className='mt-auto'>
                <ul className='text-muted-foreground list-outside list-disc space-y-2 pl-4 text-sm'>
                  {target.notes.map(note => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

export default DownloadSection
