import type { ReactNode } from 'react'

import Header from '@/components/layout/header'
import Footer from '@/components/layout/footer'

import { navigationData } from '@/assets/data/navigation'

const PagesLayout = ({ children }: Readonly<{ children: ReactNode }>) => {
  return (
    <div className='relative'>
      {/* Header Section */}
      <Header navigationData={navigationData} />
      {/* Main Content */}
      <main className='flex flex-col'>{children}</main>
      {/* Footer Section */}
      <Footer />
    </div>
  )
}

export default PagesLayout
