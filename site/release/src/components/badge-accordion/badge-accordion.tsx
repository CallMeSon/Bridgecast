import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'

import Inline from '@/components/inline'

import type { Section, SectionType } from '@/lib/releases'

const COLORS: Record<SectionType, string> = {
  new: 'bg-green-600/10 text-green-700 dark:bg-green-400/10 dark:text-green-400',
  updates: 'bg-sky-600/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-400',
  bugfixes: 'bg-amber-600/10 text-amber-700 dark:bg-orange-400/10 dark:text-orange-400',
  other: 'bg-muted text-muted-foreground'
}

const BadgeAccordion = ({ data }: { data: Section[] }) => {
  return (
    <Accordion type='multiple' className='-mt-4 mb-0 w-full' defaultValue={data.map((_, i) => `item-${i + 1}`)}>
      {data.map((section, index) => (
        <AccordionItem key={index} value={`item-${index + 1}`}>
          <AccordionTrigger className='px-0 hover:no-underline [&>svg]:size-6!'>
            <Badge className={`h-6 rounded-sm border-none ${COLORS[section.type]}`}>{section.title}</Badge>
          </AccordionTrigger>
          <AccordionContent className='text-muted-foreground'>
            <ul className='text-muted-foreground list-outside list-disc space-y-3 pl-5 text-sm leading-relaxed'>
              {section.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

export default BadgeAccordion
