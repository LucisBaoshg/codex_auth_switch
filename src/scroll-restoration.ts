export function renderedPageKeyForView(view: string): string {
  if (view === "sharing") return "sharing-center";
  return view;
}

export function currentRenderedPageKey(appRoot: ParentNode): string | null {
  return (
    appRoot.querySelector<HTMLElement>(".app-main-content [data-page]")?.dataset.page ??
    null
  );
}

export type RestoreMainScrollOptions = {
  appRoot: ParentNode;
  previousPageKey: string | null;
  previousScrollTop: number;
  currentView: string;
  requestAnimationFrame?: (callback: () => void) => void;
};

export function restoreMainScrollIfSamePage(options: RestoreMainScrollOptions): void {
  const {
    appRoot,
    previousPageKey,
    previousScrollTop,
    currentView,
    requestAnimationFrame,
  } = options;

  if (!previousPageKey || previousPageKey !== renderedPageKeyForView(currentView)) return;
  const main = appRoot.querySelector<HTMLElement>(".app-main-content");
  if (!main) return;

  main.scrollTop = previousScrollTop;
  requestAnimationFrame?.(() => {
    if (currentRenderedPageKey(appRoot) === previousPageKey) {
      main.scrollTop = previousScrollTop;
    }
  });
}

export type NestedScrollTops = Record<string, number>;

export function captureNestedScrollTops(appRoot: ParentNode): NestedScrollTops {
  const scrollTops: NestedScrollTops = {};
  appRoot.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((element) => {
    const key = element.dataset.scrollKey;
    if (key) {
      scrollTops[key] = element.scrollTop;
    }
  });
  return scrollTops;
}

export type RestoreNestedScrollOptions = {
  appRoot: ParentNode;
  previousPageKey: string | null;
  previousScrollTops: NestedScrollTops;
  currentView: string;
  requestAnimationFrame?: (callback: () => void) => void;
};

export function restoreNestedScrollTopsIfSamePage(options: RestoreNestedScrollOptions): void {
  const {
    appRoot,
    previousPageKey,
    previousScrollTops,
    currentView,
    requestAnimationFrame,
  } = options;

  if (!previousPageKey || previousPageKey !== renderedPageKeyForView(currentView)) return;

  const restore = (): void => {
    if (currentRenderedPageKey(appRoot) !== previousPageKey) return;
    appRoot.querySelectorAll<HTMLElement>("[data-scroll-key]").forEach((element) => {
      const key = element.dataset.scrollKey;
      if (key && Object.prototype.hasOwnProperty.call(previousScrollTops, key)) {
        element.scrollTop = previousScrollTops[key];
      }
    });
  };

  restore();
  requestAnimationFrame?.(restore);
}
