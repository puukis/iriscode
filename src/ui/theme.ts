const prefersDarkTerminal = (() => {
  const termProgram = (process.env.TERM_PROGRAM ?? '').toLowerCase();
  const colorTerm = (process.env.COLORTERM ?? '').toLowerCase();
  return (
    colorTerm.includes('truecolor')
    || colorTerm.includes('24bit')
    || termProgram.includes('iterm')
    || termProgram.includes('warp')
    || termProgram.includes('wezterm')
  );
})();

const rounded = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
};

const single = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
};

export const theme = {
  mode: prefersDarkTerminal ? 'dark' : 'light',
  colors: {
    primary: 'blueBright',
    success: 'green',
    warning: 'yellow',
    error: 'red',
    dim: 'gray',
    accent: 'cyan',
    builtin: 'blue',
    custom: 'green',
    skill: 'magenta',
    text: prefersDarkTerminal ? 'white' : 'black',
    background: prefersDarkTerminal ? 'black' : 'white',
    surface: prefersDarkTerminal ? '#34353a' : '#e7e7ea',
    surfaceText: prefersDarkTerminal ? '#f3f4f6' : '#111827',
    muted: prefersDarkTerminal ? '#8f9098' : '#5b6470',
    line: prefersDarkTerminal ? '#6f7179' : '#b8bcc4',
    brand: '#e08a68',
  },
  borders: {
    single,
    rounded,
  },
  spinners: {
    dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  },
  spacing: {
    xs: 0,
    sm: 1,
    md: 2,
  },
  layout: {
    statusBarHeight: 1,
    inputBarHeight: 3,
  },
} as const;

export type Theme = typeof theme;
