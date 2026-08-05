const { getTheme, BRAND } = require('../utils/theme');

describe('getTheme', () => {
  it('returns dark theme when mode is dark', () => {
    const theme = getTheme('dark', 'light');
    expect(theme.dark).toBe(true);
    expect(theme.bg).toBe('#0A0A0A');
  });

  it('returns light theme when mode is light', () => {
    const theme = getTheme('light', 'dark');
    expect(theme.dark).toBe(false);
    expect(theme.bg).toBe('#F2F2F7');
  });

  it('returns dark theme when mode is system and sys is dark', () => {
    const theme = getTheme('system', 'dark');
    expect(theme.dark).toBe(true);
  });

  it('returns light theme when mode is system and sys is light', () => {
    const theme = getTheme('system', 'light');
    expect(theme.dark).toBe(false);
  });

  it('includes all required theme keys', () => {
    const theme = getTheme('dark', 'light');
    const requiredKeys = ['bg', 'surface', 'surface2', 'surface3', 'text', 'textSub', 'textMuted', 'accent', 'danger', 'warn', 'ok', 'border'];
    requiredKeys.forEach(key => {
      expect(theme).toHaveProperty(key);
    });
  });

  it('BRAND constant is defined', () => {
    expect(BRAND).toBe('#CFD91A');
  });
});