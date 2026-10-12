// GENERATED — DO NOT EDIT. Run scripts/build-candidate-url.mjs.
/**
 * The existing Owner/Admin candidate route, with a portal origin or a relative path. The route
 * resolves `<surfaceId>/<route…>` against the commit's own routes, so a page with no landing
 * view opens only when `routePath` names one of its routes.
 */
export function candidateUrl(
  mintHost               ,
  org        ,
  commitSha        ,
  surfaceId        ,
  routePath         = ''
)         {
  return `${mintHost ?? ''}/${org}/_surface-candidate/${commitSha}/${surfaceId}/${routePath}`;
}

/**
 * The route a candidate link opens: the landing view (`''`), else the first route in manifest
 * order with no `:param` segment. Null when every route needs a record id.
 */
export function surfaceEntryPath(routes                             )                {
  const open =
    routes.find((route) => route.path === '') ??
    routes.find((route) => !route.path.split('/').some((segment) => segment.startsWith(':')));
  return open ? open.path : null;
}
