## Summary

<!-- What does this change and why? Link any related issue. -->

## Changes

-

## Testing

<!-- From `source/`. Tick what you ran. -->

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run eval`
- [ ] `npm run build` (if UI / Next.js config changed)
- [ ] Manually exercised in the dashboard (`npm run dev`)

## Security checklist

- [ ] No direct `child_process` imports in `src/app/**` or `src/features/**` — subprocesses go through `@/lib/runner` (R1.4)
- [ ] No secrets, API keys, `.env` files or personal config committed
- [ ] New dependencies are necessary and reviewed
