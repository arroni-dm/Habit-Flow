import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {ensureWritableWindowFetch} from './lib/browserGuard.ts';

if (typeof window !== 'undefined') {
  ensureWritableWindowFetch(window);
}

createRoot(document.getElementById('root')!).render(<App />);
