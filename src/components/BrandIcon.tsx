import React from 'react';
import { Globe } from 'lucide-react';
import { getBrandIcon } from '../services/brandIcons';

interface BrandIconProps {
  name: string;
  size?: number;
  fallback?: 'globe' | null;
  fallbackColor?: string;
  showLabel?: boolean;
}

/**
 * Renders the REAL brand logo (Discord, Reddit, YouTube, ...) for an app name
 * or website domain, colored with its authentic brand color. Falls back to a
 * neutral globe glyph when the brand is unknown.
 */
export const BrandIcon: React.FC<BrandIconProps> = ({
  name,
  size = 16,
  fallback = 'globe',
  fallbackColor,
  showLabel = false,
}) => {
  const brand = getBrandIcon(name);

  if (brand) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <path d={brand.path} fill={brand.hex} />
      </svg>
    );
  }

  if (fallback === 'globe') {
    return <Globe style={{ width: size, height: size, flexShrink: 0 }} color={fallbackColor} />;
  }

  return null;
};

export default BrandIcon;