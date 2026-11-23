import { expect, test } from 'rstack/test';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

test('renders the placeholder web app', () => {
  render(<App />);
  expect(
    screen.getByRole('heading', { name: 'railprint' }),
  ).toBeInTheDocument();
});
