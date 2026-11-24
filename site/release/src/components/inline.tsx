// Renders the little markdown the changelog uses: `code`, **bold** and [text](url).
const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g

const Inline = ({ text }: { text: string }) => {
  return (
    <>
      {text.split(TOKEN).map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className='bg-muted rounded px-1 py-0.5 font-mono text-[0.9em]'>
              {part.slice(1, -1)}
            </code>
          )
        }

        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>
        }

        const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part)

        if (link) {
          return (
            <a key={i} href={link[2]} className='text-primary underline underline-offset-2'>
              {link[1]}
            </a>
          )
        }

        return part
      })}
    </>
  )
}

export default Inline
