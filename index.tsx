import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log('Index.tsx loaded');

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

console.log('Root element found, mounting React app...');

const root = ReactDOM.createRoot(rootElement);
// Removed StrictMode to prevent double-mounting of Three.js scene
root.render(<App />);

console.log('React app mounted');