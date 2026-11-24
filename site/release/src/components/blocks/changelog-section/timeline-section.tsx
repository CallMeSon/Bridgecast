import TimelineItem from '@/components/timeline/timeline-items'
import Accordion from '@/components/badge-accordion/badge-accordion'

import type { Release } from '@/lib/releases'

function TimelineSection({ releases }: { releases: Release[] }) {
  return (
    <section id='changelog' className='scroll-mt-18'>
      <div className='mx-auto max-w-4xl px-4 py-10 md:px-8 md:py-16'>
        <div className='mb-12 space-y-4 text-center'>
          <h2 className='text-2xl font-semibold md:text-3xl lg:text-4xl'>Changelog</h2>
          <p className='text-muted-foreground text-xl'>What was added, changed and fixed in every release.</p>
        </div>
        <div className='flex flex-col items-start'>
          {releases.map(release => (
            <div key={release.tag} className='w-full'>
              <TimelineItem date={release.date} version={release.tag}>
                <div className='space-y-4'>
                  <h3 className='text-xl font-semibold'>
                    <a href={release.url} className='hover:text-primary'>
                      Bridgecast {release.version}
                    </a>
                  </h3>
                  <Accordion data={release.sections} />
                </div>
              </TimelineItem>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default TimelineSection
