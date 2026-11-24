import Link from 'next/link'

import { navigationData } from '@/assets/data/navigation'

import Logo from '@/components/logo'

const Footer = () => {
  return (
    <footer>
      <div className='mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 max-md:flex-col sm:px-8 sm:py-6 md:gap-6 md:py-8'>
        <Link href='/#home'>
          <Logo className='gap-3' />
        </Link>

        <div className='flex items-center gap-5 whitespace-nowrap lg:gap-12'>
          {navigationData.map(item => (
            <a
              key={item.title}
              href={item.href}
              className='text-muted-foreground hover:text-primary text-base! font-medium hover:bg-transparent'
            >
              {item.title}
            </a>
          ))}
        </div>
      </div>

      <div className='via-primary/20 mx-auto h-px w-4/5 bg-gradient-to-r from-transparent to-transparent'></div>

      <div className='mx-auto flex max-w-7xl justify-center px-4 py-8 sm:px-6'>
        <p className='text-muted-foreground text-center text-sm text-balance'>
          {`© ${new Date().getFullYear()} Bridgecast`}
        </p>
      </div>
    </footer>
  )
}

export default Footer
