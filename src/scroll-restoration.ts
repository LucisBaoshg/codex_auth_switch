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
