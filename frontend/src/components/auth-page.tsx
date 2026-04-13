import { useState } from "react";
import { Flame, Mail, Lock, User, Eye, EyeOff, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const API_URL = import.meta.env.VITE_API_URL as string;

interface AuthPageProps {
  onAuthSuccess?: () => void;
}

function getPasswordStrength(password: string): { label: string; color: string; width: string } {
  if (password.length === 0) return { label: "", color: "bg-gray-200", width: "w-0" };
  if (password.length < 6) return { label: "Weak", color: "bg-red-400", width: "w-1/4" };
  if (password.length < 10) return { label: "Fair", color: "bg-yellow-400", width: "w-1/2" };
  if (password.length < 14 || !/[^a-zA-Z0-9]/.test(password))
    return { label: "Good", color: "bg-blue-400", width: "w-3/4" };
  return { label: "Strong", color: "bg-green-500", width: "w-full" };
}

export function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCredits, setShowCredits] = useState(false);

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Signup form state
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");

  const passwordStrength = getPasswordStrength(signupPassword);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed. Please check your credentials.");
        return;
      }
      localStorage.setItem("token", data.token);
      onAuthSuccess?.();
    } catch {
      setError("Could not reach the server. Is the backend running?");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (signupPassword !== signupConfirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: signupEmail, password: signupPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Registration failed.");
        return;
      }
      // Auto-login after successful registration
      const loginRes = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: signupEmail, password: signupPassword }),
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok) {
        setError("Registered successfully — please log in.");
        return;
      }
      localStorage.setItem("token", loginData.token);
      onAuthSuccess?.();
    } catch {
      setError("Could not reach the server. Is the backend running?");
    } finally {
      setIsLoading(false);
    }
  };

  return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-red-50 to-yellow-50 p-4">
        <div className="w-full max-w-md" style={{ maxWidth: '28rem' }}>

          {/* Logo and Title */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-3">
              <Flame className="h-10 w-10 text-red-500" />
              <div className="text-left">
                <h1 className="text-2xl font-bold leading-tight tracking-tight font-heading">
                  Firewatch
                </h1>
                <p className="text-sm text-muted-foreground">Geo-Info Data Visualization</p>
              </div>
            </div>
          </div>

          {/* Auth Card */}
          <Card className="shadow-xl border-0">
            <Tabs defaultValue="login" className="w-full" onValueChange={() => setError(null)}>
              <CardHeader className="pb-4">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">Log in</TabsTrigger>
                  <TabsTrigger value="signup">Create account</TabsTrigger>
                </TabsList>
              </CardHeader>

              {/* ── Login Tab ── */}
              <TabsContent value="login">
                <form onSubmit={handleLogin} noValidate>
                  <CardContent className="space-y-4">
                    <div>
                      <CardTitle className="text-2xl font-heading">Welcome back</CardTitle>
                      <CardDescription className="mt-1">
                        Enter your credentials to access your dashboard
                      </CardDescription>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="login-email">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            id="login-email"
                            type="email"
                            placeholder="you@example.com"
                            className="pl-10"
                            autoComplete="email"
                            value={loginEmail}
                            onChange={(e) => setLoginEmail(e.target.value)}
                            required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="login-password">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            id="login-password"
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            className="pl-10 pr-10"
                            autoComplete="current-password"
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            required
                        />
                        <button
                            type="button"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" className="rounded" />
                        <span className="text-muted-foreground">Remember me</span>
                      </label>
                      {/* Neutral color — not red, which reads as destructive */}
                      <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors text-sm"
                      >
                        Forgot password?
                      </button>
                    </div>
                  </CardContent>

                  <CardFooter className="flex flex-col gap-4">
                    {error && (
                        <p role="alert" className="text-sm text-red-500 w-full text-center bg-red-50 rounded-md py-2 px-3">
                          {error}
                        </p>
                    )}
                    <Button
                        type="submit"
                        className="w-full bg-red-500 hover:bg-red-600"
                        disabled={isLoading}
                    >
                      {isLoading ? "Signing in…" : "Sign in"}
                    </Button>

                  </CardFooter>
                </form>
              </TabsContent>

              {/* ── Signup Tab ── */}
              <TabsContent value="signup">
                <form onSubmit={handleSignup} noValidate>
                  <CardContent className="space-y-4">
                    <div>
                      <CardTitle className="text-2xl font-heading">Create an account</CardTitle>
                      <CardDescription className="mt-1">
                        Get started with wildfire monitoring and alerts
                      </CardDescription>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-name">Full name</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            id="signup-name"
                            type="text"
                            placeholder="Jane Smith"
                            className="pl-10"
                            autoComplete="name"
                            value={signupName}
                            onChange={(e) => setSignupName(e.target.value)}
                            required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            id="signup-email"
                            type="email"
                            placeholder="you@example.com"
                            className="pl-10"
                            autoComplete="email"
                            value={signupEmail}
                            onChange={(e) => setSignupEmail(e.target.value)}
                            required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            id="signup-password"
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            className="pl-10 pr-10"
                            autoComplete="new-password"
                            value={signupPassword}
                            onChange={(e) => setSignupPassword(e.target.value)}
                            required
                            minLength={8}
                        />
                        <button
                            type="button"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {/* Password strength indicator */}
                      {signupPassword.length > 0 && (
                          <div className="space-y-1">
                            <div className="h-1 w-full bg-gray-200 rounded-full overflow-hidden">
                              <div
                                  className={`h-full rounded-full transition-all duration-300 ${passwordStrength.color} ${passwordStrength.width}`}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Strength: <span className="font-medium text-foreground">{passwordStrength.label}</span>
                            </p>
                          </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-confirm-password">Confirm password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                            id="signup-confirm-password"
                            type={showConfirmPassword ? "text" : "password"}
                            placeholder="••••••••"
                            className="pl-10 pr-10"
                            autoComplete="new-password"
                            value={signupConfirmPassword}
                            onChange={(e) => setSignupConfirmPassword(e.target.value)}
                            required
                            minLength={8}
                        />
                        {/* Fixed: confirm password now has its own toggle */}
                        <button
                            type="button"
                            aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {/* Inline mismatch hint */}
                      {signupConfirmPassword.length > 0 && signupPassword !== signupConfirmPassword && (
                          <p className="text-xs text-red-500">Passwords don't match</p>
                      )}
                    </div>

                    <div className="flex items-start gap-2">
                      <input type="checkbox" required className="mt-1 rounded" id="terms" />
                      <label htmlFor="terms" className="text-sm text-muted-foreground cursor-pointer">
                        I agree to the{" "}
                        <button type="button" className="text-red-500 hover:text-red-600 underline-offset-2 hover:underline">
                          Terms of Service
                        </button>{" "}
                        and{" "}
                        <button type="button" className="text-red-500 hover:text-red-600 underline-offset-2 hover:underline">
                          Privacy Policy
                        </button>
                      </label>
                    </div>
                  </CardContent>

                  <CardFooter className="flex flex-col gap-4">
                    {error && (
                        <p role="alert" className="text-sm text-red-500 w-full text-center bg-red-50 rounded-md py-2 px-3">
                          {error}
                        </p>
                    )}
                    <Button
                        type="submit"
                        className="w-full bg-red-500 hover:bg-red-600"
                        disabled={isLoading}
                    >
                      {isLoading ? "Creating account…" : "Create account"}
                    </Button>

                  </CardFooter>
                </form>
              </TabsContent>
            </Tabs>
          </Card>

          {/* Continue without login */}
          <div className="text-center mt-4">
            <Button
                variant="ghost"
                onClick={() => onAuthSuccess?.()}
                className="text-muted-foreground hover:text-foreground text-sm"
            >
              Continue without login
            </Button>
          </div>

          {/* Team attribution — collapsed by default to reduce clutter */}
          <div className="text-center mt-3">
            <button
                type="button"
                onClick={() => setShowCredits(!showCredits)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              About this project
              <ChevronDown className={`h-3 w-3 transition-transform ${showCredits ? "rotate-180" : ""}`} />
            </button>
            {showCredits && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed max-w-sm mx-auto">
                  Wildfire Prediction Senior Research Project at California State University, Northridge.
                  Team: Ido Cohen, Alex Hernandez-Abrego, Sannia Jean, Ivan Lopez, Tony Song.
                </p>
            )}
          </div>

        </div>
      </div>
  );
}

