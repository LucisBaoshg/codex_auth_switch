const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBasePath(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (!basePath) {
    return normalizedPath;
  }

  return normalizedPath === "/" ? basePath : `${basePath}${normalizedPath}`;
}
