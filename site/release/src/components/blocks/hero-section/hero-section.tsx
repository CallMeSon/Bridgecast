import { ArrowDownIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import type { Release } from '@/lib/releases'

function HeroSection({ latest }: { latest?: Release }) {
  return (
    <section id='home' className='-mt-17.5 pt-17.5'>
      <div className='space-y-4 px-4 py-8 text-center md:px-8 md:py-16'>
        {latest && (
          <Badge className='h-auto text-sm font-normal' variant='outline' asChild>
            <a href={`#${latest.tag}`}>
              Latest: {latest.version} · {latest.date}
            </a>
          </Badge>
        )}
        <h1 className='text-3xl font-semibold text-balance md:text-4xl lg:text-5xl'>
          One operator console for the whole show
        </h1>
        <p className='text-muted-foreground mx-auto max-w-2xl text-xl text-balance'>
          Bridgecast runs your decks, PDFs, videos and live web pages on one Program output: fullscreen on the
          projector, and over the network with OMT and NDI.
        </p>
        <div className='flex justify-center gap-3 max-sm:flex-col max-sm:items-center'>
          <Button size='lg' className='rounded-lg text-base max-sm:w-full' asChild>
            <a href='#download'>
              Download
              <ArrowDownIcon className='size-5' />
            </a>
          </Button>
          <Button size='lg' variant='outline' className='rounded-lg text-base max-sm:w-full' asChild>
            <a href='#changelog'>What&apos;s new</a>
          </Button>
        </div>
      </div>
    </section>
  )
}

export default HeroSection
