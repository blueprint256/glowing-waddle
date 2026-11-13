import { createTheme, alpha, type Theme } from '@mui/material/styles';
import type { ThemeMode } from '../store/themeStore';

/**
 * Blueprint → MUI bridge.
 *
 * styles/tokens.css is the single source of truth for the design language.
 * MUI needs real colour values (it does maths on them), so the few that the
 * palette requires are mirrored here. Everything else in the app should use the
 * CSS variables (var(--border), var(--bg-raised) …) or theme palette paths.
 * If you change a value in tokens.css, change it here too.
 */
const raw = {
  dark: {
    shell: '#242424', panel: '#141414', raised: '#2e2e2e', hover: '#3b3b3b', subtle: '#1f1f1f',
    border: '#3b3b3b', borderStrong: '#424242',
    text: '#c9c9c9', textStrong: '#ffffff', textMuted: '#b8b8b8', textFaint: '#696969',
    primary: '#e9ecef', primaryHover: '#dee2e6', primaryFg: '#000000',
    danger: '#e03131', success: '#40c057', warning: '#fd7e14', info: '#228be6',
    shadowModal:
      '0 1px 3px rgba(0,0,0,.05), 0 36px 28px -7px rgba(0,0,0,.05), 0 17px 17px -7px rgba(0,0,0,.04)',
    shadowPop: '0 10px 30px rgba(0,0,0,.35)'
  },
  light: {
    shell: '#f4f3f1', panel: '#ffffff', raised: '#ffffff', hover: '#efedea', subtle: '#f4f3f1',
    border: '#efedea', borderStrong: '#ccc5ba',
    text: '#000000', textStrong: '#18181b', textMuted: '#8c806d', textFaint: '#a99e8d',
    primary: '#2e2e2e', primaryHover: '#242424', primaryFg: '#ffffff',
    danger: '#e03131', success: '#2f9e44', warning: '#e8590c', info: '#1c7ed6',
    shadowModal:
      '0 1px 3px rgba(0,0,0,.05), 0 36px 28px -7px rgba(0,0,0,.05), 0 17px 17px -7px rgba(0,0,0,.04)',
    shadowPop: '0 10px 30px rgba(52,46,39,.18)'
  }
} as const;

const FONT_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';

/** Control height from the design system (--h-ctl). */
const CTL = 31;

export function buildTheme(mode: ThemeMode): Theme {
  const c = raw[mode];

  return createTheme({
    // Matches --bp-sm / --bp-md / --bp-lg / --bp-xl in tokens.css (576 / 768 / 992 / 1200).
    // md (768) is the sidebar-vs-drawer switch, lg (992) widens insets.
    breakpoints: { values: { xs: 0, sm: 576, md: 768, lg: 992, xl: 1200 } },
    palette: {
      mode,
      primary: { main: c.primary, dark: c.primaryHover, contrastText: c.primaryFg },
      secondary: { main: mode === 'dark' ? '#868e96' : '#6e6253' },
      error: { main: c.danger },
      warning: { main: c.warning },
      success: { main: c.success },
      info: { main: c.info },
      background: { default: c.shell, paper: c.raised },
      text: {
        primary: c.text,
        secondary: c.textMuted,
        disabled: c.textFaint
      },
      divider: c.border,
      action: {
        hover: alpha(mode === 'dark' ? '#ffffff' : '#342e27', 0.06),
        selected: alpha(mode === 'dark' ? '#ffffff' : '#342e27', 0.1),
        focus: alpha(mode === 'dark' ? '#ffffff' : '#342e27', 0.12)
      }
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: FONT_SANS,
      // html font-size stays 16px; body copy is 13px (--fs-sm).
      fontSize: 13,
      htmlFontSize: 16,
      h1: { fontSize: '1.5625rem', fontWeight: 600, lineHeight: 1.5 },
      h2: { fontSize: '1.5625rem', fontWeight: 600, lineHeight: 1.5 },
      // Page titles (existing pages use variant="h4") = hero headline, 25px / 600.
      h3: { fontSize: '1.75rem', fontWeight: 600, lineHeight: 1.3 }, // big stat numbers
      h4: { fontSize: '1.5625rem', fontWeight: 600, lineHeight: 1.5, '@media (max-width:767.95px)': { fontSize: '1.3125rem' } },
      h5: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
      h6: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4 },
      subtitle1: { fontSize: '0.875rem', fontWeight: 500 },
      subtitle2: { fontSize: '0.8125rem', fontWeight: 500 },
      body1: { fontSize: '0.8125rem', lineHeight: 1.55 },
      body2: { fontSize: '0.75rem', lineHeight: 1.55 },
      button: { fontSize: '0.8125rem', fontWeight: 500, textTransform: 'none', letterSpacing: '-0.01em' },
      caption: { fontSize: '0.6875rem', lineHeight: 1.4 },
      overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.04em' }
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: c.shell, color: c.text },
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: c.hover,
            borderRadius: 9999,
            border: `2px solid ${c.panel}`
          },
          '*::-webkit-scrollbar-track': { backgroundColor: 'transparent' }
        }
      },

      /* ---------- Buttons ---------- */
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 8, minHeight: CTL, padding: '4px 14px', transition: 'background-color .15s, border-color .15s' },
          sizeSmall: { minHeight: 26, padding: '2px 10px', fontSize: '0.75rem' },
          sizeLarge: { minHeight: 38, padding: '6px 18px' },
          outlined: { borderColor: c.borderStrong, color: c.textStrong, '&:hover': { borderColor: c.textFaint, backgroundColor: alpha(c.textStrong, 0.06) } },
          text: { color: c.textStrong }
        }
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiFab: { styleOverrides: { root: { boxShadow: 'none' } } },

      /* ---------- Inputs (31px control height) ---------- */
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiFormControl: { defaultProps: { size: 'small' } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundColor: c.raised,
            minHeight: CTL,
            fontSize: '0.8125rem',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: c.border },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: c.borderStrong },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: c.textMuted, borderWidth: 1 }
          },
          input: { padding: '6px 10px', height: 19, boxSizing: 'content-box' },
          inputSizeSmall: { padding: '6px 10px' },
          multiline: { padding: 0 },
          inputMultiline: { height: 'auto' }
        }
      },
      MuiSelect: { styleOverrides: { select: { minHeight: 'auto', paddingTop: 6, paddingBottom: 6 } } },
      MuiInputLabel: { styleOverrides: { root: { fontSize: '0.8125rem' } } },
      MuiFormLabel: { styleOverrides: { root: { color: c.textMuted } } },
      MuiAutocomplete: { styleOverrides: { inputRoot: { padding: '2px 8px !important' } } },
      MuiCheckbox: { styleOverrides: { root: { color: c.textFaint } } },
      MuiSwitch: { styleOverrides: { root: { '& .MuiSwitch-track': { opacity: 1, backgroundColor: c.hover } } } },

      /* ---------- Surfaces ---------- */
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: 'none' } }
      },
      MuiCard: {
        styleOverrides: { root: { borderRadius: 10, border: `1px solid ${c.border}`, backgroundColor: c.raised } }
      },
      MuiCardContent: { styleOverrides: { root: { padding: 16, '&:last-child': { paddingBottom: 16 } } } },
      MuiAppBar: { styleOverrides: { root: { backgroundColor: c.shell, color: c.text, boxShadow: 'none' } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundColor: c.shell, borderRight: 'none', backgroundImage: 'none' } } },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: c.panel,
            border: `1px solid ${c.border}`,
            borderRadius: 16,
            boxShadow: c.shadowModal,
            // Keep tall dialogs usable on phones.
            '@media (max-width:575.95px)': { margin: 12, width: 'calc(100% - 24px)', maxHeight: 'calc(100% - 24px)' }
          }
        }
      },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: '0.875rem', fontWeight: 600, color: c.textStrong, padding: '16px 20px' } } },
      MuiDialogContent: { styleOverrides: { root: { padding: '8px 20px 16px' } } },
      MuiDialogActions: { styleOverrides: { root: { padding: '12px 20px 16px', gap: 8 } } },
      MuiBackdrop: { styleOverrides: { root: { backgroundColor: 'rgba(0,0,0,.45)' } } },
      MuiMenu: {
        styleOverrides: {
          paper: { backgroundColor: c.shell, border: `1px solid ${c.border}`, borderRadius: 12, boxShadow: c.shadowPop }
        }
      },
      MuiPopover: {
        styleOverrides: {
          paper: { backgroundColor: c.shell, border: `1px solid ${c.border}`, borderRadius: 12, boxShadow: c.shadowPop }
        }
      },
      MuiMenuItem: { styleOverrides: { root: { fontSize: '0.8125rem', minHeight: 32, borderRadius: 6, margin: '0 4px' } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { backgroundColor: c.hover, color: c.textStrong, fontSize: '0.6875rem', border: `1px solid ${c.borderStrong}` }
        }
      },

      /* ---------- Data display ---------- */
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 9999, height: 22, fontSize: '0.6875rem', fontWeight: 500 },
          sizeMedium: { height: 26, fontSize: '0.75rem' }
        }
      },
      MuiTableContainer: { styleOverrides: { root: { overflowX: 'auto' } } },
      MuiTableCell: {
        styleOverrides: {
          root: { borderBottom: `1px solid ${c.border}`, padding: '10px 14px', fontSize: '0.8125rem' },
          head: { color: c.textMuted, fontSize: '0.75rem', fontWeight: 500, backgroundColor: 'transparent', whiteSpace: 'nowrap' }
        }
      },
      MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: alpha(c.textStrong, 0.05) } } } },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: c.textStrong, height: 2 } } },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none', minHeight: 40, fontSize: '0.8125rem', fontWeight: 500, color: c.textMuted, '&.Mui-selected': { color: c.textStrong } }
        }
      },
      MuiAccordion: {
        defaultProps: { disableGutters: true },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${c.border}`,
            borderRadius: 10,
            '&:before': { display: 'none' },
            '&:not(:last-child)': { marginBottom: 8 }
          }
        }
      },
      MuiAlert: { styleOverrides: { root: { borderRadius: 8, fontSize: '0.8125rem' } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 9999, backgroundColor: c.hover } } },
      MuiDivider: { styleOverrides: { root: { borderColor: c.border } } },
      MuiListItemButton: {
        styleOverrides: { root: { borderRadius: 6, '&.Mui-selected': { backgroundColor: c.hover } } }
      },
      MuiLink: { styleOverrides: { root: { color: c.textStrong } } }
    }
  });
}
