import * as React from "react"
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
  redirect,
  Outlet,
} from "@tanstack/react-router"
import { Loader2, Lock, TriangleAlert } from "lucide-react"

import { ChatSection } from "@/components/chat/chat-section"
import { AppDashboard } from "@/components/layout/app-dashboard"
import { UploadSection } from "@/components/upload/upload-section"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { API_BASE_URL, readError } from "@/lib/api"

interface AuthState {
  isAuthenticated: boolean
  token: string | null
  username: string | null
  login: (token: string, username: string) => void
  logout: () => void
}

interface MyRouterContext {
  auth: AuthState
}

export const rootRoute = createRootRouteWithContext<MyRouterContext>()({
  component: () => <Outlet />,
})

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
      })
    }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { auth } = rootRoute.useRouteContext()

  const handleLogout = () => {
    auth.logout()
  }

  return <AppDashboard username={auth.username} onLogout={handleLogout} />
}

function UploadPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <UploadSection />
    </div>
  )
}

function ChatPage() {
  const { auth } = rootRoute.useRouteContext()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatSection token={auth.token!} />
    </div>
  )
}

const uploadRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/upload",
  component: UploadPage,
})

const chatRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/chat",
  component: ChatPage,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ context }) => {
    throw redirect({ to: context.auth.isAuthenticated ? "/upload" : "/login" })
  },
})

const DEFAULT_AUTH_REDIRECT = "/upload"
const LOGIN_PATH = "/login"

function normalizeAuthRedirect(redirectTarget: unknown) {
  if (typeof redirectTarget !== "string" || !redirectTarget) {
    return DEFAULT_AUTH_REDIRECT
  }

  const base =
    typeof window === "undefined" ? "http://localhost" : window.location.origin

  try {
    const url = new URL(redirectTarget, base)

    if (url.origin !== base) {
      return DEFAULT_AUTH_REDIRECT
    }

    const target = `${url.pathname}${url.search}${url.hash}`

    if (
      target === LOGIN_PATH ||
      target.startsWith(`${LOGIN_PATH}?`) ||
      target.startsWith(`${LOGIN_PATH}#`)
    ) {
      return DEFAULT_AUTH_REDIRECT
    }

    return target.startsWith("/") ? target : DEFAULT_AUTH_REDIRECT
  } catch {
    return DEFAULT_AUTH_REDIRECT
  }
}

function LoginPage() {
  const { auth } = rootRoute.useRouteContext()
  const [authUsername, setAuthUsername] = React.useState("")
  const [authPassword, setAuthPassword] = React.useState("")
  const [authLoading, setAuthLoading] = React.useState(false)
  const [authError, setAuthError] = React.useState<string | null>(null)
  const [authMode, setAuthMode] = React.useState<"login" | "register">("login")

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    if (!authUsername.trim() || !authPassword.trim()) {
      setAuthError("All fields are required")
      return
    }
    setAuthLoading(true)
    try {
      if (authMode === "register") {
        const res = await fetch(`${API_BASE_URL}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: authUsername.trim(),
            password: authPassword.trim(),
          }),
        })
        if (!res.ok) throw new Error(await readError(res))
      }

      const params = new URLSearchParams()
      params.append("username", authUsername.trim())
      params.append("password", authPassword.trim())

      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      })
      if (!res.ok) throw new Error(await readError(res))

      const data = await res.json()
      auth.login(data.access_token, data.username)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err))
    } finally {
      setAuthLoading(false)
    }
  }

  return (
    <main className="flex h-svh items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="size-6 shrink-0" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold">Local RAG</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        <form onSubmit={handleAuthSubmit} className="flex flex-col gap-4">
          <Tabs
            value={authMode}
            onValueChange={(v) => {
              setAuthMode(v as "login" | "register")
              setAuthError(null)
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="login" className="flex-1">
                Sign in
              </TabsTrigger>
              <TabsTrigger value="register" className="flex-1">
                Sign up
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-col gap-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              required
              placeholder="Username"
              value={authUsername}
              onChange={(e) => setAuthUsername(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              placeholder="Password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
            />
          </div>

          {authError ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              <span>{authError}</span>
            </div>
          ) : null}

          <Button type="submit" disabled={authLoading} className="w-full">
            {authLoading ? (
              <Loader2
                className="size-4 shrink-0 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            {authMode === "login" ? "Sign in" : "Sign up"}
          </Button>
        </form>
      </div>
    </main>
  )
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>) => {
    return { redirect: normalizeAuthRedirect(search.redirect) }
  },
  beforeLoad: ({ context, search }) => {
    if (context.auth.isAuthenticated) {
      throw redirect({ to: search.redirect })
    }
  },
  component: LoginPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  authenticatedRoute.addChildren([uploadRoute, chatRoute]),
  loginRoute,
])

const router = createRouter({
  routeTree,
  context: {
    auth: undefined!,
  },
})

function InnerApp({ auth }: { auth: AuthState }) {
  const tokenRef = React.useRef(auth.token)

  React.useEffect(() => {
    if (tokenRef.current === auth.token) {
      return
    }
    tokenRef.current = auth.token
    void router.invalidate()
  }, [auth.token, auth.isAuthenticated])

  return <RouterProvider router={router} context={{ auth }} />
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

export function App() {
  const [token, setToken] = React.useState<string | null>(() =>
    localStorage.getItem("token")
  )
  const [username, setUsername] = React.useState<string | null>(() =>
    localStorage.getItem("username")
  )

  const auth = React.useMemo<AuthState>(
    () => ({
      isAuthenticated: token !== null,
      token,
      username,
      login: (newToken: string, newUsername: string) => {
        localStorage.setItem("token", newToken)
        localStorage.setItem("username", newUsername)
        setToken(newToken)
        setUsername(newUsername)
      },
      logout: () => {
        localStorage.removeItem("token")
        localStorage.removeItem("username")
        setToken(null)
        setUsername(null)
      },
    }),
    [token, username]
  )

  return <InnerApp auth={auth} />
}

export default App
