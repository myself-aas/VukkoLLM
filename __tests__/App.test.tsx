import React from 'react';
import { render, screen } from '@testing-library/react-native';
import App from '../src/app/App';
import { colors } from '../src/theme';

describe('App root', () => {
  test('renders the Vukko header on the dark theme background', () => {
    render(<App />);

    const header = screen.getByRole('header', { name: 'Vukko' });
    expect(header).toBeTruthy();
    expect(screen.getByText('Local-first AI workspace')).toBeTruthy();
    expect(screen.getByText('Vukko')).toHaveStyle({ color: colors.accent });
  });
});
