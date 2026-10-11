import { ThemeId } from '../types';

export interface ThemeColors {
  id: ThemeId;
  name: string;
  isDark: boolean;
  bgPrimary: string;
  bgSecondary: string;
  bgCard: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  accentText: string;
  success: string;
  warning: string;
  danger: string;
}

export const THEMES: Record<ThemeId, ThemeColors> = {
  // --- 1. MODERN MINIMALIST (Light) ---
  moder: {
    id: 'moder',
    name: 'Modern Minimal',
    isDark: false,
    bgPrimary: '#f8fafc',
    bgSecondary: '#f1f5f9',
    bgCard: '#ffffff',
    border: 'rgba(15, 23, 42, 0.08)',
    textPrimary: '#090d16',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    accent: '#2563eb',
    accentHover: '#1d4ed8',
    accentText: '#ffffff',
    success: '#059669',
    warning: '#d97706',
    danger: '#e11d48',
  },

  // --- 2. SOFT PAPER / WARM PARCHMENT (Light) ---
  soft_paper: {
    id: 'soft_paper',
    name: 'Soft Paper',
    isDark: false,
    bgPrimary: '#faf7f2',
    bgSecondary: '#f2ede4',
    bgCard: '#ffffff',
    border: 'rgba(68, 64, 60, 0.1)',
    textPrimary: '#292524',
    textSecondary: '#57534e',
    textMuted: '#a8a29e',
    accent: '#c25e00',
    accentHover: '#9a4700',
    accentText: '#ffffff',
    success: '#15803d',
    warning: '#b45309',
    danger: '#be123c',
  },

  // --- 3. LAVENDER MIST (Light/Pastel) ---
  lavender: {
    id: 'lavender',
    name: 'Lavender Mist',
    isDark: false,
    bgPrimary: '#f7f6fd',
    bgSecondary: '#eeebfa',
    bgCard: '#ffffff',
    border: 'rgba(109, 40, 217, 0.1)',
    textPrimary: '#2e1065',
    textSecondary: '#5b21b6',
    textMuted: '#8b5cf6',
    accent: '#7c3aed',
    accentHover: '#6d28d9',
    accentText: '#ffffff',
    success: '#059669',
    warning: '#d97706',
    danger: '#e11d48',
  },

  // --- 4. MATCHA ZEN (Light/Nature) ---
  matcha: {
    id: 'matcha',
    name: 'Matcha Zen',
    isDark: false,
    bgPrimary: '#f2f8f4',
    bgSecondary: '#e4f0e8',
    bgCard: '#ffffff',
    border: 'rgba(5, 150, 105, 0.12)',
    textPrimary: '#0f291e',
    textSecondary: '#2d5a44',
    textMuted: '#659c80',
    accent: '#059669',
    accentHover: '#047857',
    accentText: '#ffffff',
    success: '#10b981',
    warning: '#d97706',
    danger: '#e11d48',
  },

  // --- 5. SUNSET ROSE (Dark/Twilight) ---
  sunset: {
    id: 'sunset',
    name: 'Sunset Rose',
    isDark: true,
    bgPrimary: '#140a18',
    bgSecondary: '#201026',
    bgCard: '#2d1835',
    border: 'rgba(251, 113, 133, 0.18)',
    textPrimary: '#fff1f2',
    textSecondary: '#fecdd3',
    textMuted: '#9f677b',
    accent: '#fb7185',
    accentHover: '#f43f5e',
    accentText: '#140a18',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f43f5e',
  },

  // --- 6. DEEP ABYSS (Dark/Cyber Oceanic) ---
  abyss: {
    id: 'abyss',
    name: 'Deep Abyss',
    isDark: true,
    bgPrimary: '#030712',
    bgSecondary: '#081120',
    bgCard: '#0f1d36',
    border: 'rgba(56, 189, 248, 0.16)',
    textPrimary: '#f0fdf4',
    textSecondary: '#93c5fd',
    textMuted: '#4773a6',
    accent: '#00f2fe',
    accentHover: '#38bdf8',
    accentText: '#030712',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f43f5e',
  },

  // --- 7. LIQUID PEARL (Enhanced Light) ---
  paper: {
    id: 'paper',
    name: 'Liquid Pearl',
    isDark: false,
    bgPrimary: '#f5f7fa',
    bgSecondary: '#eaedf3',
    bgCard: '#ffffff',
    border: 'rgba(0, 0, 0, 0.08)',
    textPrimary: '#0f172a',
    textSecondary: '#334155',
    textMuted: '#64748b',
    accent: '#0ea5e9',
    accentHover: '#0284c7',
    accentText: '#ffffff',
    success: '#10b981',
    warning: '#d97706',
    danger: '#ef4444',
  },

  // --- 8. OBSIDIAN AURORA (Dark) ---
  serika: {
    id: 'serika',
    name: 'Obsidian Aurora',
    isDark: true,
    bgPrimary: '#08090e',
    bgSecondary: '#0f1118',
    bgCard: '#151824',
    border: 'rgba(255, 255, 255, 0.08)',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    accent: '#38bdf8',
    accentHover: '#0ea5e9',
    accentText: '#08090e',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f43f5e',
  },

  // --- 9. OLED CYBER CARBON (Dark) ---
  carbon: {
    id: 'carbon',
    name: 'OLED Cyber Carbon',
    isDark: true,
    bgPrimary: '#050507',
    bgSecondary: '#0c0c10',
    bgCard: '#141419',
    border: 'rgba(255, 255, 255, 0.09)',
    textPrimary: '#f4f4f5',
    textSecondary: '#a1a1aa',
    textMuted: '#52525b',
    accent: '#f59e0b',
    accentHover: '#d97706',
    accentText: '#050507',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
  },

  // --- 10. GLACIER FROST (Dark) ---
  nord: {
    id: 'nord',
    name: 'Glacier Frost',
    isDark: true,
    bgPrimary: '#090d14',
    bgSecondary: '#0f1520',
    bgCard: '#161f2f',
    border: 'rgba(136, 192, 208, 0.15)',
    textPrimary: '#f1f5f9',
    textSecondary: '#cbd5e1',
    textMuted: '#64748b',
    accent: '#38bdf8',
    accentHover: '#7dd3fc',
    accentText: '#090d14',
    success: '#4ade80',
    warning: '#facc15',
    danger: '#fb7185',
  },

  // --- 11. MATRIX JADE (Dark) ---
  emerald: {
    id: 'emerald',
    name: 'Matrix Jade',
    isDark: true,
    bgPrimary: '#060d09',
    bgSecondary: '#0b1610',
    bgCard: '#112219',
    border: 'rgba(52, 211, 153, 0.15)',
    textPrimary: '#ecfdf5',
    textSecondary: '#a7f3d0',
    textMuted: '#4b7a63',
    accent: '#10b981',
    accentHover: '#34d399',
    accentText: '#060d09',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f43f5e',
  },

  // --- 12. TOKYO NEON VIOLET (Dark) ---
  dracula: {
    id: 'dracula',
    name: 'Tokyo Neon Violet',
    isDark: true,
    bgPrimary: '#090812',
    bgSecondary: '#110f21',
    bgCard: '#19162e',
    border: 'rgba(168, 85, 247, 0.18)',
    textPrimary: '#faf5ff',
    textSecondary: '#d8b4fe',
    textMuted: '#7e64a4',
    accent: '#a855f7',
    accentHover: '#c084fc',
    accentText: '#090812',
    success: '#4ade80',
    warning: '#fb923c',
    danger: '#f43f5e',
  },

  // --- 13. SOLAR ESPRESSO (Dark) ---
  mocha: {
    id: 'mocha',
    name: 'Solar Espresso',
    isDark: true,
    bgPrimary: '#0d0a08',
    bgSecondary: '#17120e',
    bgCard: '#221a15',
    border: 'rgba(217, 119, 6, 0.15)',
    textPrimary: '#fef3c7',
    textSecondary: '#fde68a',
    textMuted: '#8c7664',
    accent: '#f59e0b',
    accentHover: '#fbbf24',
    accentText: '#0d0a08',
    success: '#84cc16',
    warning: '#f59e0b',
    danger: '#f43f5e',
  },
};
