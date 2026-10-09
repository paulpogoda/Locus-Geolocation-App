import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import 'leaflet/dist/leaflet.css';
import App from './App.tsx';
import './index.css';

const root = createRoot(document.getElementById('root')!);

// GitHub Pages cannot send `frame-ancestors`, so refuse to render inside a frame
// to keep the settings dialog (API key) out of clickjacking pages.
if (window.top !== window.self) {
  root.render(<p style={{ padding: 16, fontFamily: 'sans-serif' }}>LOCUS cannot be embedded in other pages.</p>);
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
