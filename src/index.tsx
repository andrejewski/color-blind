import React from 'react';
import ReactDOM from 'react-dom/client';
import { appProgram } from './app';
import './index.css';
import { reactProgram } from './raj-react';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

const App = reactProgram(() => appProgram)

root.render(
  <React.StrictMode>
    <App/>
  </React.StrictMode>
);


