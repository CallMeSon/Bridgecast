import { ArrowRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

import { REPO_URL } from '@/lib/releases'

const CTASection = () => {
  return (
    <section className='bg-primary py-8 sm:py-10 lg:py-16'>
      <div className='mx-auto max-w-5xl px-4 sm:px-6 lg:px-8'>
        <Card className='bg-primary rounded-none border-0 shadow-none'>
          <CardContent className='flex justify-between gap-6 max-lg:flex-col md:px-8 lg:items-center'>
            <div className='space-y-4'>
              <h2 className='text-primary-foreground text-2xl font-semibold md:text-3xl lg:text-4xl'>
                Every build, every file
              </h2>
              <p className='text-primary-foreground/80 text-lg md:text-xl'>
                All releases and their files are on GitHub, with the update metadata the app reads.
              </p>
            </div>
            <div>
              <Button size='lg' variant='secondary' className='shrink-0 rounded-lg text-base has-[>svg]:px-6' asChild>
                <a href={`${REPO_URL}/releases`} className='inline-flex items-center gap-2'>
                  All releases on GitHub
                  <ArrowRightIcon className='size-5' />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export default CTASection
