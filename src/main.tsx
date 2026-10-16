import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { QuickCapture } from './components/QuickCapture';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

// The global-shortcut capture popup loads the same bundle with ?capture=1
// and renders only the tiny capture UI — no app state, no sync.
const isCapture = new URLSearchParams(window.location.search).has('capture');

root.render(
  <React.StrictMode>
    {isCapture ? <QuickCapture /> : <App />}
  </React.StrictMode>
);
