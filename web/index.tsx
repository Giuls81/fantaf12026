import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// GLOBAL ERROR TRAP (Build 83)
window.onerror = function(msg, url, line, col, error) {
  document.body.innerHTML = `
    <div style="background:maroon; color:white; padding:20px; font-family:monospace; height:100vh; overflow:auto;">
      <h1>CRITICAL ERROR (Build 83)</h1>
      <p>${msg}</p>
      <p>${url}:${line}:${col}</p>
      <pre>${error?.stack || 'No Stack'}</pre>
      <button onclick="location.reload()" style="padding:10px; margin-top:20px;">RELOAD</button>
      <button onclick="localStorage.clear(); location.reload()" style="padding:10px; margin-top:20px; background:red; color:white; border:none;">RESET DATA</button>
    </div>
  `;
  return false;
};

window.onunhandledrejection = function(event) {
  document.body.innerHTML = `
    <div style="background:darkblue; color:white; padding:20px; font-family:monospace; height:100vh; overflow:auto;">
      <h1>UNHANDLED PROMISE (Build 83)</h1>
      <p>${event.reason}</p>
      <button onclick="location.reload()" style="padding:10px; margin-top:20px;">RELOAD</button>
      <button onclick="localStorage.clear(); location.reload()" style="padding:10px; margin-top:20px; background:red; color:white; border:none;">RESET DATA</button>
    </div>
  `;
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
