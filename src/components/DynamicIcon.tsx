import React from 'react';
import * as Icons from 'lucide-react';

interface DynamicIconProps {
  name: string;
  className?: string;
  size?: number;
  style?: React.CSSProperties;
}

export const DynamicIcon: React.FC<DynamicIconProps> = ({ name, className = 'w-5 h-5', size, style }) => {
  const IconComponent = (Icons as unknown as Record<string, React.ComponentType<{ className?: string; size?: number; style?: React.CSSProperties }>>)[name] || Icons.Compass;
  return <IconComponent className={className} size={size} style={style} />;
};

export const AVAILABLE_ICONS = [
  { name: 'Target', label: 'Target / Lesson' },
  { name: 'BookOpen', label: 'Book / Reading' },
  { name: 'Brain', label: 'Brain / Deep Study' },
  { name: 'Trophy', label: 'Trophy / Chess' },
  { name: 'Coffee', label: 'Coffee / Chill' },
  { name: 'Code', label: 'Code / Programming' },
  { name: 'PenTool', label: 'Writing / Essays' },
  { name: 'Feather', label: 'Feather / Creative' },
  { name: 'Flame', label: 'Flame / High Focus' },
  { name: 'Zap', label: 'Zap / Sprint' },
  { name: 'Compass', label: 'Compass / Exploration' },
  { name: 'Clock', label: 'Clock / Timing' },
  { name: 'Music', label: 'Music / Audio' },
  { name: 'Sparkles', label: 'Sparkles / Polish' },
];
