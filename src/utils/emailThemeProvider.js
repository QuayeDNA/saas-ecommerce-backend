import { getEmailTheme, getDefaultEmailTheme } from "./appContextResolver.js";

export function resolveEmailTheme(appContext) {
  if (!appContext?.appId) {
    return getDefaultEmailTheme();
  }
  return getEmailTheme(appContext.appId);
}

export function buildEmailStyles(theme) {
  return {
    container:
      `font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;`,
    header:
      `background: ${theme.headerGradient}; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;`,
    headerTitle:
      `color: #fff; margin: 0; font-size: 24px;`,
    headerLogo:
      `max-height: 48px; margin-bottom: 8px;`,
    body:
      `padding: 30px; background: ${theme.bodyBg}; border-radius: 0 0 8px 8px;`,
    text:
      `font-size: 16px; color: ${theme.textPrimary}; margin: 0 0 12px 0;`,
    textSecondary:
      `font-size: 14px; color: ${theme.textSecondary}; margin: 0 0 8px 0;`,
    textMuted:
      `font-size: 12px; color: ${theme.textMuted}; margin: 0;`,
    button:
      `background-color: ${theme.primary}; color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;`,
    buttonSecondary:
      `background-color: ${theme.textMuted}; color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-size: 16px;`,
    link:
      `color: ${theme.primary}; text-decoration: underline;`,
    divider:
      `border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;`,
    otpCode:
      `font-size: 36px; font-weight: bold; letter-spacing: 8px; color: ${theme.primary}; background: ${theme.cardBg}; padding: 15px 30px; border-radius: 8px; border: 2px dashed ${theme.primary};`,
    footer:
      `font-size: 12px; color: ${theme.textMuted}; text-align: center; margin-top: 20px;`,
  };
}

export function buildEmailLayout({ title, contentHtml, theme, logoUrl }) {
  const s = buildEmailStyles(theme);
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${theme.brandName}" style="${s.headerLogo}" />`
    : "";

  return `
    <div style="${s.container}">
      <div style="${s.header}">
        ${logoHtml}
        <h1 style="${s.headerTitle}">${title}</h1>
      </div>
      <div style="${s.body}">
        ${contentHtml}
        <hr style="${s.divider}" />
        <p style="${s.footer}">
          ${theme.footerText}
          ${theme.supportEmail ? ` | <a href="mailto:${theme.supportEmail}" style="color: ${theme.textMuted};">${theme.supportEmail}</a>` : ""}
        </p>
      </div>
    </div>
  `;
}

export default { resolveEmailTheme, buildEmailStyles, buildEmailLayout };
