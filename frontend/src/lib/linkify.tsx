import { Fragment, ReactNode } from 'react';

// Erkennt http/https-URLs sowie mit „www.“ beginnende Adressen.
const URL_REGEX = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

// Satzzeichen, die häufig direkt an eine URL angrenzen, aber nicht mehr Teil
// der Adresse sind (z. B. „… siehe https://example.com.“ oder „(https://…)“).
const TRAILING_PUNCTUATION = /[.,!?;:)\]}'"]+$/;

/**
 * Zerlegt einen Text in normale Text-Abschnitte und anklickbare Links. URLs
 * werden als `<a>`-Elemente gerendert, die im Standardbrowser in einem neuen
 * Tab öffnen. Der Klick auf einen Link wird gestoppt, damit er nicht ein
 * umgebendes klickbares Element (z. B. eine auf-/zuklappbare Notiz-Karte)
 * auslöst.
 *
 * Bewusst nur für die Anzeige gedacht – im Bearbeitungsmodus bleibt der Text
 * ein reines `<textarea>`.
 */
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  URL_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(text)) !== null) {
    const start = match.index;
    let url = match[0];

    // Angrenzende Satzzeichen wieder abtrennen und als normalen Text behandeln.
    let trailing = '';
    const trailMatch = url.match(TRAILING_PUNCTUATION);
    if (trailMatch) {
      trailing = trailMatch[0];
      url = url.slice(0, url.length - trailing.length);
    }

    // Text vor der URL.
    if (start > lastIndex) {
      nodes.push(<Fragment key={key++}>{text.slice(lastIndex, start)}</Fragment>);
    }

    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    nodes.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>,
    );

    if (trailing) nodes.push(<Fragment key={key++}>{trailing}</Fragment>);

    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }

  return nodes;
}
