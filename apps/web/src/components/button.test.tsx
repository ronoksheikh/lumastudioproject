import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button (HeroUI + @heroui/ripple)', () => {
  it('adds a ripple where it is pressed and still calls onPress', async () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.className).toContain('overflow-hidden');
    await userEvent.click(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Save')).toBeInTheDocument();
    expect(btn.querySelector('.heroui-ripple')).not.toBeNull();
  });

  it('can be turned off', async () => {
    render(<Button disableRipple>Plain</Button>);
    const btn = screen.getByRole('button', { name: 'Plain' });
    await userEvent.click(btn);
    expect(btn.querySelector('.heroui-ripple')).toBeNull();
  });
});
