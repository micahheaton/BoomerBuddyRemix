import Link from 'next/link';
import { designTokens } from '@boomerbuddy/design';

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link className="brand" href={href} aria-label="BoomerBuddy home">
      <svg className="brand-mark" width="34" height="38" viewBox="0 0 34 38" aria-hidden="true">
        <path
          d="M17 1.5 31.5 7v10.2c0 9.1-5.7 15.7-14.5 19.3C8.2 32.9 2.5 26.3 2.5 17.2V7L17 1.5Z"
          fill={designTokens.colors.primary}
          stroke={designTokens.colors.primaryHover}
          strokeWidth="2.5"
        />
        <path
          d="m10.2 19 4.1 4.1 9.7-10"
          fill="none"
          stroke={designTokens.colors.onPrimary}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
      </svg>
      <span>BoomerBuddy</span>
    </Link>
  );
}
