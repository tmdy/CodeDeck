# Runtime evidence

## Current log

- `browser-auth:login` starts for normalized origin `https://muyuan.do` and slot 1.
- Every probe classifies the deployment as `browser_cookie`.
- `/api/user/self` repeatedly returns HTTP 403 and the result remains `retry`; no account save event follows.

## Site frontend contract

The currently loaded public frontend bundle:

- reads `localStorage.user.id` for the global `New-API-User` Axios header;
- creates ordinary management requests with `New-API-User` and `Cache-Control` headers;
- stores a token in `localStorage.user`, but does not attach Bearer to the ordinary `/api/user/self` request path.

## Conclusion

The previous partition-routing and Bearer-removal fixes are active but incomplete. The packaged runtime continued returning 403 after the no-Bearer retry, while the same BrowserWindow displayed authenticated balance and check-in data. The remaining cross-layer failure is transport equivalence: `Session.fetch` is not accepted as the same client as the loaded page. The compatible fallback must issue a strict same-origin page request and still require a matching backend user ID.
