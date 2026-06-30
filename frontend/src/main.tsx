import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { UploadsProvider } from './context/Uploads';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <UploadsProvider>
        <App />
      </UploadsProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
