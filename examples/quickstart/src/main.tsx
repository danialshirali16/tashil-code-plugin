import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckoutCard } from './CheckoutCard';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <CheckoutCard />
    </main>
  </StrictMode>,
);

