import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from '@luma/shared';
import './styles.css';

function App() {
  const [health, setHealth] = useState<string>('checking…');
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((j) => setHealth(j.ok ? 'API online' : 'API error'))
      .catch(() => setHealth('API unreachable'));
  }, []);
  return (
    <main className="hero">
      <h1>{APP_NAME}</h1>
      <p>AI motion graphics, by Lumademy.</p>
      <span className="chip">{health}</span>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
