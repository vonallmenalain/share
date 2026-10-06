// Kleine Polyfills für die PDF-Anzeige (pdf.js) auf älteren Geräten. Wird
// sowohl im Hauptthread (lib/pdf.ts) als auch im PDF-Worker (lib/pdfWorker.ts)
// geladen – darf deshalb weder `window` noch das DOM voraussetzen.

type WithResolvers = <T>() => {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

// Promise.withResolvers: erst ab Safari/iOS 17.4 bzw. Chrome 119 vorhanden,
// pdf.js setzt es aber voraus. Ohne diesen Polyfill bliebe die PDF-Anzeige auf
// älteren iPhones/Android-Geräten leer.
const promiseCtor = Promise as unknown as { withResolvers?: WithResolvers };
if (typeof promiseCtor.withResolvers !== 'function') {
  promiseCtor.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
