import { expect, test } from 'rstack/test';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

test('shows a loading state before the release data arrives', () => {
  globalThis.fetch = () => new Promise<Response>(() => {});
  render(<App />);
  expect(screen.getByText('正在加载线路数据…')).toBeInTheDocument();
});
