import { registerSW } from 'virtual:pwa-register';

export function registerAppPwa(): void {
  registerSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(async () => {
          if (!navigator.onLine) return;
          try { await registration.update(); } catch {}
        }, 60 * 60 * 1000);
      }
    },
    onOfflineReady() {
      console.log('[PWA] App ready for offline use');
    },
  });
}
