import HeroSection from '@/components/blocks/hero-section/hero-section'
import DownloadSection from '@/components/blocks/download-section/download-section'
import TimelineSection from '@/components/blocks/changelog-section/timeline-section'
import FAQ from '@/components/blocks/faq-section/faq-section'
import CTA from '@/components/blocks/cta-section/cta-section'

import { faqItems } from '@/assets/data/faq-content'
import { getReleases, pickDownloads } from '@/lib/releases'

const Divider = () => (
  <div className='via-primary/20 mx-auto h-px w-4/5 bg-linear-to-r from-transparent to-transparent'></div>
)

const Home = async () => {
  const releases = await getReleases()
  const latest = releases[0]

  return (
    <div>
      <HeroSection latest={latest} />
      <DownloadSection downloads={pickDownloads(releases)} />
      <Divider />
      <TimelineSection releases={releases} />
      <Divider />
      <FAQ faqItems={faqItems} />
      <CTA />
    </div>
  )
}

export default Home
