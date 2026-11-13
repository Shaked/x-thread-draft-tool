The vercel-ignore test now strips the hook's GIT_* variables from its child git processes, so it cannot commit into the hooked repo.
