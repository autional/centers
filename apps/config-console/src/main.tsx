import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ThemeProvider } from '@autional/ui';
import { AntdThemeProvider } from '@autional/ui/antd';
import App from './App';
import './i18n';
import './styles/globals.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider storageKey="config-console-theme">
        <AntdThemeProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AntdThemeProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
