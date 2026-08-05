import { createAuthClient } from "better-auth/react"

const authClientBaseUrl = process.env.NEXT_PUBLIC_BETTER_AUTH_URL;

export const authClient = createAuthClient({
    /**
     * Keep this undefined for same-origin requests.
     * Setting localhost here causes CORS issues when the app is opened on 127.0.0.1.
     */
    ...(authClientBaseUrl ? { baseURL: authClientBaseUrl } : {}),
})
