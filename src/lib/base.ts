// Vite injects BASE_URL: "/" in dev, "/voice/" in the deployed build
// (set via VITE_BASE_PATH at build time). All same-origin URLs — API calls
// and static assets like voice previews — must go through this helper so
// they land under the sub-path instead of hitting LibreChat's routes.
export function withBase(path: string): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "") + path;
}
