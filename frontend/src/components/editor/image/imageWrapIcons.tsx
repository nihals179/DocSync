import type { ImageWrap } from '../textModel';

type WrapIconProps = {
  className?: string;
};

export function InlineWrapIcon({ className = 'h-4 w-4' }: WrapIconProps) {
  return (
    <svg viewBox="0 -960 960 960" className={className} fill="currentColor" aria-hidden="true">
      <path d="M120-120v-80h720v80H120Zm0-160v-400h400v400H120Zm80-80h240v-240H200v240Zm-80-400v-80h720v80H120Zm200 280Zm280 200v-80h240v80H600Z" />
    </svg>
  );
}

export function BreakLineWrapIcon({ className = 'h-4 w-4' }: WrapIconProps) {
  return (
    <svg viewBox="0 -960 960 960" className={className} fill="currentColor" aria-hidden="true">
      <path d="M120-120v-80h720v80H120Zm0-160v-400h400v400H120Zm80-80h240v-240H200v240Zm-80-400v-80h720v80H120Zm200 280Z" />
    </svg>
  );
}

export function FrontTextWrapIcon({ className = 'h-4 w-4' }: WrapIconProps) {
  return (
    <svg viewBox="0 -960 960 960" className={className} fill="currentColor" aria-hidden="true">
      <path d="M120-120v-80h720v80H120Zm0-160v-80h160v-80H120v-80h160v-80H120v-80h720v80H680v80h160v80H680v80h160v80H120Zm240-80h240v-80H360v80Zm0-160h240v-80H360v80ZM120-760v-80h720v80H120Zm360 320Zm0-80Z" />
    </svg>
  );
}

export function WrapTextWrapIcon({ className = 'h-4 w-4' }: WrapIconProps) {
  return (
    <svg viewBox="0 -960 960 960" className={className} fill="currentColor" aria-hidden="true">
      <path d="M120-280v-400h400v400H120Zm80-80h240v-240H200v240Zm-80-400v-80h720v80H120Zm480 160v-80h240v80H600Zm0 160v-80h240v80H600Zm0 160v-80h240v80H600ZM120-120v-80h720v80H120Zm200-360Z" />
    </svg>
  );
}

export function ImageWrapIcon({ wrap, className = 'h-4 w-4' }: { wrap: ImageWrap; className?: string }) {
  switch (wrap) {
    case 'break':
      return <BreakLineWrapIcon className={className} />;
    case 'inline':
      return <InlineWrapIcon className={className} />;
    case 'front':
      return <FrontTextWrapIcon className={className} />;
    case 'wrap':
      return <WrapTextWrapIcon className={className} />;
    default:
      return null;
  }
}