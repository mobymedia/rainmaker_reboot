import { render, screen, fireEvent } from '@testing-library/react';
import Rainmaker from '../app/Rainmaker';

describe('Rainmaker', () => {
  it('renders without crashing', () => {
    render(<Rainmaker />);
    expect(screen.getByText('Rainmaker')).toBeInTheDocument();
  });

  it('shows connect wallet button when not connected', () => {
    render(<Rainmaker />);
    expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
  });

  it('allows CSV input', () => {
    render(<Rainmaker />);
    const textarea = screen.getByPlaceholderText(/0xabc123/);
    fireEvent.change(textarea, { target: { value: '0x123,0.1\n0x456,0.2' } });
    expect(textarea).toHaveValue('0x123,0.1\n0x456,0.2');
  });
});