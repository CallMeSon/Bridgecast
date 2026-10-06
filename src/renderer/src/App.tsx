import { Presentation } from '@phosphor-icons/react'

function App(): React.JSX.Element {
  return (
    <main
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--panel)',
        color: 'var(--text)'
      }}
    >
      <h1
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 'var(--fs-brand)',
          fontWeight: 650,
          padding: '12px 20px',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-panel)',
          boxShadow: 'var(--shadow)'
        }}
      >
        <Presentation size={18} color="var(--accent)" />
        PPT Share
      </h1>
    </main>
  )
}

export default App
