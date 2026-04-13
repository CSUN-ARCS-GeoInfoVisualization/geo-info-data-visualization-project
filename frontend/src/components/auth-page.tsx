import { useState, useEffect } from "react";
import {
  Mail, Lock, User, Eye, EyeOff, Flame, Shield, MapPin, Activity,
  ArrowRight, Loader2, CheckCircle2,
} from "lucide-react";
import { FireScopeBrandMark } from "./firescope-brand";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const API_URL = import.meta.env.VITE_API_URL as string;

interface AuthPageProps {
  onAuthSuccess?: () => void;
}

function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-red-950/80 to-orange-950/60" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-red-500/10 rounded-full blur-3xl animate-pulse" />
      <div
        className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-orange-500/8 rounded-full blur-3xl animate-pulse"
        style={{ animationDelay: "1s", animationDuration: "4s" }}
      />
      <div
        className="absolute top-1/3 right-1/3 w-64 h-64 bg-amber-500/6 rounded-full blur-3xl animate-pulse"
        style={{ animationDelay: "2s", animationDuration: "5s" }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,rgba(0,0,0,0.4)_100%)]" />
    </div>
  );
}

function FeatureHighlight({ icon: Icon, title, desc, delay }: {
  icon: typeof Flame; title: string; desc: string; delay: string;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const ms = parseFloat(delay) * 1000;
    const t = setTimeout(() => setVisible(true), ms);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div
      className="flex items-start gap-3 transition-all duration-700"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(12px)",
      }}
    >
      <div className="rounded-lg bg-white/10 p-2 backdrop-blur-sm border border-white/10 shrink-0">
        <Icon className="h-4 w-4 text-orange-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-white/90">{title}</p>
        <p className="text-xs text-white/50">{desc}</p>
      </div>
    </div>
  );
}

export function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(t);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }
      localStorage.setItem("token", data.token);
      setSuccess("Welcome back! Redirecting...");
      setTimeout(() => onAuthSuccess?.(), 600);
    } catch {
      setError("Could not reach the server. Is the backend running?");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (signupPassword !== signupConfirmPassword) {
      setError("Passwords do not match");
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
        setError(data.error || "Registration failed");
        return;
      }
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
      setSuccess("Account created! Redirecting...");
      setTimeout(() => onAuthSuccess?.(), 600);
    } catch {
      setError("Could not reach the server. Is the backend running?");
    } finally {
      setIsLoading(false);
    }
  };

  const passwordStrength = signupPassword.length === 0
    ? 0
    : signupPassword.length < 8
      ? 1
      : /(?=.*[A-Z])(?=.*[0-9])/.test(signupPassword)
        ? 3
        : 2;

  const strengthLabel = ["", "Weak", "Fair", "Strong"][passwordStrength];
  const strengthColor = ["", "bg-red-500", "bg-yellow-500", "bg-emerald-500"][passwordStrength];

  return (
    <div className="min-h-screen flex">
      <AnimatedBackground />

      {/* Left panel — feature showcase (hidden on mobile) */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-center px-12 xl:px-20 transition-all duration-1000"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateX(0)" : "translateX(-24px)",
        }}
      >
        <div className="max-w-md">
          <FireScopeBrandMark height={48} variant="plain" className="mb-8 brightness-0 invert opacity-90" />

          <h1 className="text-3xl xl:text-4xl font-bold text-white mb-3 leading-tight">
            Real-time wildfire<br />intelligence platform
          </h1>
          <p className="text-white/50 text-base mb-10 leading-relaxed">
            Monitor fire risk, receive instant alerts, and access predictive analytics
            powered by machine learning and satellite data.
          </p>

          <div className="space-y-5">
            <FeatureHighlight
              icon={Activity}
              title="Live Risk Assessment"
              desc="ML-powered predictions updated every 15 minutes"
              delay="0.3"
            />
            <FeatureHighlight
              icon={MapPin}
              title="Interactive Fire Maps"
              desc="Satellite imagery with real-time incident overlays"
              delay="0.5"
            />
            <FeatureHighlight
              icon={Shield}
              title="Smart Alert System"
              desc="Customizable notifications by zone and severity"
              delay="0.7"
            />
          </div>
        </div>
      </div>

      {/* Right panel — auth form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div
          className="w-full max-w-md transition-all duration-700"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(16px)",
          }}
        >
          {/* Mobile logo */}
          <div className="text-center mb-6 lg:hidden">
            <FireScopeBrandMark height={56} variant="plain" className="mx-auto brightness-0 invert opacity-90 mb-3" />
            <p className="text-white/50 flex items-center justify-center gap-2 text-sm">
              <Flame className="h-3.5 w-3.5 text-orange-400" aria-hidden />
              Wildfire risk prediction & monitoring
            </p>
          </div>

          <Card className="shadow-2xl border-0 bg-white/95 backdrop-blur-xl">
            <Tabs defaultValue="login" className="w-full" onValueChange={() => { setError(null); setSuccess(null); }}>
              <CardHeader className="space-y-1 pb-4">
                <TabsList className="grid w-full grid-cols-2 h-11">
                  <TabsTrigger value="login" className="text-sm font-medium">Sign In</TabsTrigger>
                  <TabsTrigger value="signup" className="text-sm font-medium">Create Account</TabsTrigger>
                </TabsList>
              </CardHeader>

              {/* Login Tab */}
              <TabsContent value="login" className="mt-0">
                <form onSubmit={handleLogin}>
                  <CardContent className="space-y-4 pt-0">
                    <div>
                      <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
                      <CardDescription className="mt-1">
                        Enter your credentials to access your dashboard
                      </CardDescription>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="login-email">Email</Label>
                      <div className="relative group">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-red-500" />
                        <Input
                          id="login-email"
                          type="email"
                          placeholder="your.email@example.com"
                          className="pl-10 h-11 transition-shadow focus:shadow-md focus:shadow-red-500/5"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="login-password">Password</Label>
                      <div className="relative group">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-red-500" />
                        <Input
                          id="login-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          className="pl-10 pr-10 h-11 transition-shadow focus:shadow-md focus:shadow-red-500/5"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input type="checkbox" className="rounded border-gray-300 text-red-500 focus:ring-red-500" />
                        <span className="text-muted-foreground">Remember me</span>
                      </label>
                      <button type="button" className="text-red-500 hover:text-red-600 transition-colors font-medium">
                        Forgot password?
                      </button>
                    </div>
                  </CardContent>

                  <CardFooter className="flex flex-col space-y-4">
                    {error && (
                      <div className="flex items-center gap-2 w-full rounded-lg bg-red-50 border border-red-200 px-3 py-2 animate-[fadeIn_0.2s_ease-out]">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                        <p className="text-sm text-red-600">{error}</p>
                      </div>
                    )}
                    {success && (
                      <div className="flex items-center gap-2 w-full rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 animate-[fadeIn_0.2s_ease-out]">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        <p className="text-sm text-emerald-600">{success}</p>
                      </div>
                    )}
                    <Button
                      type="submit"
                      variant="ghost"
                      className="w-full h-11 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white font-medium shadow-lg shadow-red-500/20 hover:shadow-red-500/30 transition-all duration-200"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <ArrowRight className="h-4 w-4 mr-2" />
                      )}
                      {isLoading ? "Signing in..." : "Sign In"}
                    </Button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-white px-2 text-muted-foreground">Or continue with</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Button variant="outline" type="button" className="h-11 hover:bg-gray-50 transition-colors">
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Google
                      </Button>
                      <Button variant="outline" type="button" className="h-11 hover:bg-gray-50 transition-colors">
                        <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                        GitHub
                      </Button>
                    </div>
                  </CardFooter>
                </form>
              </TabsContent>

              {/* Signup Tab */}
              <TabsContent value="signup" className="mt-0">
                <form onSubmit={handleSignup}>
                  <CardContent className="space-y-4 pt-0">
                    <div>
                      <CardTitle className="text-2xl font-bold">Create an account</CardTitle>
                      <CardDescription className="mt-1">
                        Get started with wildfire monitoring and alerts
                      </CardDescription>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-name">Full Name</Label>
                      <div className="relative group">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-red-500" />
                        <Input
                          id="signup-name"
                          type="text"
                          placeholder="John Doe"
                          className="pl-10 h-11 transition-shadow focus:shadow-md focus:shadow-red-500/5"
                          value={signupName}
                          onChange={(e) => setSignupName(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email</Label>
                      <div className="relative group">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-red-500" />
                        <Input
                          id="signup-email"
                          type="email"
                          placeholder="your.email@example.com"
                          className="pl-10 h-11 transition-shadow focus:shadow-md focus:shadow-red-500/5"
                          value={signupEmail}
                          onChange={(e) => setSignupEmail(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <div className="relative group">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-red-500" />
                        <Input
                          id="signup-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          className="pl-10 pr-10 h-11 transition-shadow focus:shadow-md focus:shadow-red-500/5"
                          value={signupPassword}
                          onChange={(e) => setSignupPassword(e.target.value)}
                          required
                          minLength={8}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {signupPassword.length > 0 && (
                        <div className="flex items-center gap-2 animate-[fadeIn_0.2s_ease-out]">
                          <div className="flex-1 flex gap-1">
                            {[1, 2, 3].map((i) => (
                              <div
                                key={i}
                                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                                  i <= passwordStrength ? strengthColor : "bg-gray-200"
                                }`}
                              />
                            ))}
                          </div>
                          <span className="text-xs text-muted-foreground">{strengthLabel}</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-confirm-password">Confirm Password</Label>
                      <div className="relative group">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-red-500" />
                        <Input
                          id="signup-confirm-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          className="pl-10 h-11 transition-shadow focus:shadow-md focus:shadow-red-500/5"
                          value={signupConfirmPassword}
                          onChange={(e) => setSignupConfirmPassword(e.target.value)}
                          required
                          minLength={8}
                        />
                        {signupConfirmPassword.length > 0 && signupPassword === signupConfirmPassword && (
                          <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500 animate-[fadeIn_0.2s_ease-out]" />
                        )}
                      </div>
                    </div>

                    <div className="flex items-start space-x-2">
                      <input type="checkbox" required className="mt-1 rounded border-gray-300 text-red-500 focus:ring-red-500" />
                      <label className="text-sm text-muted-foreground">
                        I agree to the{" "}
                        <button type="button" className="text-red-500 hover:text-red-600 font-medium">Terms of Service</button>{" "}
                        and{" "}
                        <button type="button" className="text-red-500 hover:text-red-600 font-medium">Privacy Policy</button>
                      </label>
                    </div>
                  </CardContent>

                  <CardFooter className="flex flex-col space-y-4">
                    {error && (
                      <div className="flex items-center gap-2 w-full rounded-lg bg-red-50 border border-red-200 px-3 py-2 animate-[fadeIn_0.2s_ease-out]">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                        <p className="text-sm text-red-600">{error}</p>
                      </div>
                    )}
                    {success && (
                      <div className="flex items-center gap-2 w-full rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 animate-[fadeIn_0.2s_ease-out]">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        <p className="text-sm text-emerald-600">{success}</p>
                      </div>
                    )}
                    <Button
                      type="submit"
                      variant="ghost"
                      className="w-full h-11 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white font-medium shadow-lg shadow-red-500/20 hover:shadow-red-500/30 transition-all duration-200"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <ArrowRight className="h-4 w-4 mr-2" />
                      )}
                      {isLoading ? "Creating account..." : "Create Account"}
                    </Button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-white px-2 text-muted-foreground">Or continue with</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Button variant="outline" type="button" className="h-11 hover:bg-gray-50 transition-colors">
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Google
                      </Button>
                      <Button variant="outline" type="button" className="h-11 hover:bg-gray-50 transition-colors">
                        <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                        GitHub
                      </Button>
                    </div>
                  </CardFooter>
                </form>
              </TabsContent>
            </Tabs>
          </Card>

          <p className="text-center text-xs text-white/30 mt-6 leading-relaxed">
            Wildfire Prediction Senior Research Project — California State University, Northridge
            <br />
            Ido Cohen, Alex Hernandez-Abrego, Sannia Jean, Ivan Lopez, Tony Song
          </p>

          <div className="text-center mt-4">
            <Button
              variant="ghost"
              onClick={() => onAuthSuccess?.()}
              className="text-white/40 hover:text-white/70 hover:bg-white/5"
            >
              Continue without login
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
