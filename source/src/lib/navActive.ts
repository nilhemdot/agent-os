// Is `href` the nav entry for `pathname`? Matches the exact route or one of
// its sub-paths, segment by segment, so /glm is not active on /glm-code and
// /seo is not active on /seo-guide. "/" only matches the home page.
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
