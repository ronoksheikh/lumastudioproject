// The app's Button: HeroUI's Button plus HeroUI's ripple click effect — the same @heroui/ripple (2.2.20) that
// HeroUI 2.8.5's Button uses: useRipple() on press, <Ripple> rendered inside a relative, overflow-hidden button,
// in the button's own text colour. Import Button from here, not from '@heroui/react'.
import { Button as HeroButton } from '@heroui/react';
import { Ripple, useRipple } from '@heroui/ripple';
import type { ComponentProps, ReactNode } from 'react';

type Props = ComponentProps<typeof HeroButton> & { disableRipple?: boolean };
type PressHandler = NonNullable<Props['onPress']>;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function ButtonWithRipple({ children, className, onPress, disableRipple, ...rest }: Props) {
  const { ripples, onClear, onPress: addRipple } = useRipple();
  const ripple = !disableRipple && !reducedMotion();
  const handlePress: PressHandler = (e) => {
    if (ripple) addRipple(e);
    onPress?.(e);
  };
  const layer = ripple ? <Ripple ripples={ripples} onClear={onClear} /> : null;
  const content = typeof children === 'function'
    ? (renderProps: Parameters<Extract<typeof children, (...a: never[]) => unknown>>[0]) => (
      <>
        {(children as (p: typeof renderProps) => ReactNode)(renderProps)}
        {layer}
      </>
    )
    : <>{children}{layer}</>;
  return (
    <HeroButton {...rest} onPress={handlePress} className={`relative overflow-hidden ${typeof className === 'string' ? className : ''}`.trim()}>
      {content as Props['children']}
    </HeroButton>
  );
}

export const Button = ButtonWithRipple;
