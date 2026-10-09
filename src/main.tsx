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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
