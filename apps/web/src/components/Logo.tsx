export function Logo({ variant = 'blue', className = 'h-7' }: { variant?: 'blue' | 'white'; className?: string }) {
  return <img src={variant === 'white' ? '/Lumademy_All_White.svg' : '/Lumademy_Primary_Blue.svg'} alt="Lumademy" className={className} />;
}
