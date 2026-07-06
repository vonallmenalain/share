import { useEffect, useState } from 'react';

// Zeigt (wenn möglich) eine Schaltfläche, um diesen Bereich als App zum
// Startbildschirm hinzuzufügen. Auf Android/Chrome wird der native Installations-
// dialog ausgelöst; auf iOS (Safari kennt kein beforeinstallprompt) wird eine
// kurze Anleitung eingeblendet. Dank des dynamischen Manifests (siehe
// lib/pwaManifest.ts) öffnet die installierte Verknüpfung direkt diesen Bereich.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  const ua = window.navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
}

export default function InstallButton({ spaceName }: { spaceName?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const canPrompt = !!deferred;
  const ios = isIOS();
  // Nur anzeigen, wenn eine Installation plausibel möglich ist.
  if (!canPrompt && !ios) return null;

  const click = async () => {
    if (deferred) {
      await deferred.prompt();
      try {
        await deferred.userChoice;
      } catch {
        /* ignore */
      }
      setDeferred(null);
    } else if (ios) {
      setShowIosHint((v) => !v);
    }
  };

  return (
    <div className="install-wrap">
      <button className="btn btn-sm" onClick={click}>
        ⤓ Zum Startbildschirm
      </button>
      {showIosHint && (
        <div className="install-hint">
          Tippe unten in Safari auf <strong>Teilen</strong> und dann auf{' '}
          <strong>„Zum Home-Bildschirm"</strong>. Die Verknüpfung öffnet direkt diesen Bereich
          {spaceName ? ` „${spaceName}"` : ''}.
        </div>
      )}
    </div>
  );
}
