## TL;DR
The reply checks now run on every owner reply.
Nothing needed from you.

## What you need to do
Nothing.

## Waiting for
- [Reply lint CI run](https://github.com/acme/sample-app/actions/runs/1): checking the PR and every file it touches, one after the other, with the full unit suite, the type check, the build and the end to end suite, in order. Expected: 5 minutes.

## Blocked on you
Nothing.

## Done
- [Reply lint golden tests](https://github.com/acme/sample-app/pull/500), for [#12 reply templates stopped](https://github.com/acme/sample-app/issues/486): catches loose labels.
  Tests: checked, unit | Production: no deployment created; production still runs `abc1234`.
